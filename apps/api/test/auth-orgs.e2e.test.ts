import { describe, expect, test } from 'bun:test'
import { treaty } from '@elysiajs/eden'
import { hashKey, keyPrefix, newInviteToken, SYSTEM_USER_ID } from '@walnut/core'
import { branches, organizationInvitations, organizationMembers, organizations } from '@walnut/db'
import { eq } from 'drizzle-orm'
import { Elysia } from 'elysia'
import { createApp } from '../src/app.ts'
import type { HexclaveServerClient } from '../src/auth/hexclave-server.ts'
import { devAuthRoutes } from '../src/routes/dev-auth.ts'
import { bearer, grant, h, ms, newAgent, newProject, personalOrgId, useHarness } from './support.ts'

useHarness()

describe('auth and org isolation', () => {
  const USER_A = '11111111-1111-1111-1111-111111111111'
  const USER_B = '22222222-2222-2222-2222-222222222222'

  test('a request with no bearer token is 401', async () => {
    // `Bearer ` (no token) overrides the harness's default auth header.
    const res = await h.api.api.projects.get({ headers: { authorization: 'Bearer ' } })
    expect(res.status).toBe(401)
  })

  test('a request with a garbage token is 401', async () => {
    const res = await h.api.api.projects.get({ headers: { authorization: 'Bearer not-a-jwt' } })
    expect(res.status).toBe(401)
  })

  test("a user cannot see or fetch another user's project", async () => {
    const alice = await h.clientFor(USER_A, { email: 'alice@example.com' })
    const bob = await h.clientFor(USER_B, { email: 'bob@example.com' })

    const created = await alice.api.projects.post({ name: 'alice-db' })
    const projectId = created.data?.id
    if (projectId === undefined) throw new Error('alice failed to create project')

    // Bob's list is empty and he can't fetch Alice's project by id.
    const bobList = await bob.api.projects.get()
    expect(bobList.data).toEqual([])
    const bobFetch = await bob.api.projects({ id: projectId }).get()
    expect(bobFetch.status).toBe(404)

    // Alice still sees exactly her own project.
    const aliceList = await alice.api.projects.get()
    expect(aliceList.data?.length).toBe(1)
    expect(aliceList.data?.[0]?.id).toBe(projectId)
  })

  test('first login provisions a personal org with an owner membership', async () => {
    const carol = await h.clientFor(USER_A, { email: 'carol@example.com' })
    // Any authenticated call triggers JIT provisioning.
    await carol.api.projects.get()

    const members = await h.ctx.db
      .select()
      .from(organizationMembers)
      .where(eq(organizationMembers.userId, USER_A))
    expect(members.length).toBe(1)
    expect(members[0]?.role).toBe('owner')

    const [org] = await h.ctx.db
      .select()
      .from(organizations)
      .where(eq(organizations.personalUserId, USER_A))
    expect(org?.isPersonal).toBe(true)
  })
})

describe('cross-org isolation', () => {
  const ALICE = '33333333-3333-3333-3333-333333333333'
  const BOB = '44444444-4444-4444-4444-444444444444'

  /** Alice owns a provisioned project with one (grant-less) agent; Bob is unrelated. */
  async function aliceProjectWithAgent() {
    const alice = await h.clientFor(ALICE, { email: 'alice@corp.test' })
    const bob = await h.clientFor(BOB, { email: 'bob@corp.test' })
    const orgs = await alice.api.organizations.get()
    const orgId = orgs.data?.find((o) => o.isPersonal)?.id
    if (orgId === undefined) throw new Error('alice has no personal org')
    const proj = await alice.api.projects.post({ name: 'alice-proj' })
    const projectId = proj.data?.id
    if (projectId === undefined) throw new Error(`project create failed: ${JSON.stringify(proj.error?.value)}`)
    const agentRes = await alice.api.organizations({ orgId }).agents.post({ name: 'a-bot' })
    const agent = agentRes.data
    if (agent === null) throw new Error(`agent create failed: ${JSON.stringify(agentRes.error?.value)}`)
    return { alice, bob, orgId, projectId, agentId: agent.id, agentKey: agent.apiKey }
  }

  test("a user cannot read, delete, or create another user's agents", async () => {
    const { bob, orgId, agentId } = await aliceProjectWithAgent()
    expect((await bob.api.agents({ id: agentId }).get()).status).toBe(404)
    expect((await bob.api.agents({ id: agentId }).delete()).status).toBe(404)
    // Bob isn't a member of Alice's org, so he can't create an agent in it either.
    expect((await bob.api.organizations({ orgId }).agents.post({ name: 'sneaky' })).status).toBe(404)
  })

  test("a user cannot see or resolve another user's scope request", async () => {
    const { alice, bob, agentKey } = await aliceProjectWithAgent()
    const reqRes = await h.api.agent.v1['scope-requests'].post({ scopes: ['db:read'] }, { headers: bearer(agentKey) })
    const requestId = reqRes.data?.id
    if (requestId === undefined) throw new Error('scope request failed')

    // Alice (owner) sees it; Bob sees nothing.
    expect((await alice.api['scope-requests'].get({ query: {} })).data?.length).toBe(1)
    expect((await bob.api['scope-requests'].get({ query: {} })).data).toEqual([])

    // Bob cannot approve or deny it...
    expect((await bob.api['scope-requests']({ id: requestId }).approve.post()).status).toBe(404)
    expect((await bob.api['scope-requests']({ id: requestId }).deny.post()).status).toBe(404)
    // ...so it is still pending for Alice.
    expect((await alice.api['scope-requests'].get({ query: { status: 'pending' } })).data?.length).toBe(1)
  })

  test("a user cannot delete another user's project", async () => {
    const { alice, bob, projectId } = await aliceProjectWithAgent()
    expect((await bob.api.projects({ id: projectId }).delete()).status).toBe(404)
    // Bob's failed delete left Alice's project intact.
    expect((await alice.api.projects({ id: projectId }).get()).status).toBe(200)
  })

  test('creating a project provisions a default main branch', async () => {
    const alice = await h.clientFor(ALICE, { email: 'alice@corp.test' })
    const proj = await alice.api.projects.post({ name: 'branchy' })
    const projectId = proj.data?.id
    if (projectId === undefined) throw new Error('project create failed')

    const rows = await h.ctx.db.select().from(branches).where(eq(branches.projectId, projectId))
    expect(rows.length).toBe(1)
    expect(rows[0]?.name).toBe('main')
    expect(rows[0]?.isDefault).toBe(true)
  })
})

describe('dev login bypass', () => {
  /** A fake Hexclave server: mints tokens with the harness keypair so they verify
   * against the real middleware, and is get-or-create idempotent by email. */
  function makeFakeHexclave(): HexclaveServerClient {
    const byEmail = new Map<string, { id: string; email: string }>()
    const emailById = new Map<string, string>()
    return {
      async getOrCreateUser(email) {
        const key = email.trim().toLowerCase()
        let user = byEmail.get(key)
        if (user === undefined) {
          user = { id: crypto.randomUUID(), email: key }
          byEmail.set(key, user)
          emailById.set(user.id, key)
        }
        return user
      },
      async createSession(userId) {
        const email = emailById.get(userId)
        const accessToken = await h.mintToken(userId, email !== undefined ? { email } : {})
        return { accessToken, refreshToken: `refresh_${userId}` }
      },
    }
  }

  function devClient() {
    return treaty(new Elysia().use(devAuthRoutes(makeFakeHexclave())))
  }

  test('returns tokens that authenticate against the dashboard', async () => {
    const dev = devClient()
    const res = await dev.dev.auth.login.post({ email: 'Dev@Example.com' })
    expect(res.status).toBe(200)
    expect(typeof res.data?.accessToken).toBe('string')
    expect(typeof res.data?.refreshToken).toBe('string')

    const auth = bearer(res.data?.accessToken ?? '')
    const created = await h.api.api.projects.post({ name: 'dev-proj' }, { headers: auth })
    expect(created.status).toBe(200)
    const list = await h.api.api.projects.get({ headers: auth })
    expect(list.data?.length).toBe(1)
  })

  test('is idempotent for the same email (same user and org)', async () => {
    const dev = devClient()
    const first = await dev.dev.auth.login.post({ email: 'repeat@example.com' })
    await h.api.api.projects.post({ name: 'p1' }, { headers: bearer(first.data?.accessToken ?? '') })

    // A second login with the same email resolves to the same user, so it sees p1.
    const second = await dev.dev.auth.login.post({ email: 'repeat@example.com' })
    const list = await h.api.api.projects.get({ headers: bearer(second.data?.accessToken ?? '') })
    expect(list.data?.length).toBe(1)
    expect(list.data?.[0]?.name).toBe('p1')
  })

  test('rejects a malformed email with 422', async () => {
    const dev = devClient()
    const res = await dev.dev.auth.login.post({ email: 'not-an-email' })
    expect(res.status).toBe(422)
  })

  test('is not mounted unless a dev-login client is supplied', async () => {
    // The default app (no devLogin option) has no /dev/auth/login route.
    const plain = createApp(h.ctx)
    const res = await plain.handle(
      new Request('http://localhost/dev/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'x@example.com' }),
      }),
    )
    expect(res.status).toBe(404)
  })
})

describe('organizations', () => {
  test('GET /api/organizations returns the caller as owner of their personal org', async () => {
    const res = await h.api.api.organizations.get()
    expect(res.status).toBe(200)
    const personal = res.data?.find((o) => o.isPersonal)
    expect(personal).toBeDefined()
    expect(personal?.role).toBe('owner')
  })

  test('GET /api/organizations/:orgId/projects lists projects with at-a-glance counts', async () => {
    const project = await newProject('counts')
    const a1 = await newAgent('a1')
    const a2 = await newAgent('a2')
    // agentCount = agents with a grant on the project, so grant both their access.
    await grant(a1.apiKey, project.id, ['db:read'])
    await grant(a2.apiKey, project.id, ['db:read'])
    const orgId = await personalOrgId()

    const res = await h.api.api.organizations({ orgId }).projects.get()
    expect(res.status).toBe(200)
    const row = res.data?.find((p) => p.id === project.id)
    expect(row?.agentCount).toBe(2)
    expect(row?.pendingRequestCount).toBe(0)
    expect(row?.defaultBranch).toBe('main')
  }, 20_000)

  test('pendingRequestCount counts only open scope requests', async () => {
    const project = await newProject('pending')
    const agent = await newAgent('bot')
    await h.api.agent.v1['scope-requests'].post({ scopes: ['db:read'] }, { headers: bearer(agent.apiKey) })
    const orgId = await personalOrgId()

    const res = await h.api.api.organizations({ orgId }).projects.get()
    expect(res.data?.find((p) => p.id === project.id)?.pendingRequestCount).toBe(1)
  })

  test('GET /api/organizations/:orgId/agents is the org-wide roster with per-project grants', async () => {
    const project = await newProject('roster')
    const agent = await newAgent('roster-bot')
    await grant(agent.apiKey, project.id, ['db:read'])
    const orgId = await personalOrgId()

    const res = await h.api.api.organizations({ orgId }).agents.get()
    expect(res.status).toBe(200)
    const bot = res.data?.find((a) => a.name === 'roster-bot')
    expect(bot?.grants.some((g) => g.resourceType === 'project' && g.projectName === 'roster')).toBe(true)
  }, 20_000)

  test('a non-member cannot read another org\'s projects or agents (404, no existence leak)', async () => {
    const orgId = await personalOrgId()
    const stranger = await h.clientFor('11111111-1111-1111-1111-111111111111', { email: 'stranger@example.com' })
    expect((await stranger.api.organizations({ orgId }).projects.get()).status).toBe(404)
    expect((await stranger.api.organizations({ orgId }).agents.get()).status).toBe(404)
  })

  test('POST /api/organizations/:orgId/projects creates the project in that org', async () => {
    const orgId = await personalOrgId()
    const created = await h.api.api.organizations({ orgId }).projects.post({ name: 'in-org' })
    expect(created.status).toBe(200)
    expect(created.data?.name).toBe('in-org')
    const list = await h.api.api.organizations({ orgId }).projects.get()
    expect(list.data?.some((p) => p.id === created.data?.id)).toBe(true)
  })

  test('a non-member cannot create a project in an org (404)', async () => {
    const orgId = await personalOrgId()
    const stranger = await h.clientFor('33333333-3333-3333-3333-333333333333', { email: 'stranger3@example.com' })
    const res = await stranger.api.organizations({ orgId }).projects.post({ name: 'sneaky' })
    expect(res.status).toBe(404)
  })

  test('GET /api/organizations/:orgId/requests lists the org\'s scope requests', async () => {
    await newProject('reqs')
    const agent = await newAgent('r-bot')
    await h.api.agent.v1['scope-requests'].post({ scopes: ['db:write'] }, { headers: bearer(agent.apiKey) })
    const orgId = await personalOrgId()

    const res = await h.api.api.organizations({ orgId }).requests.get({ query: { status: 'pending' } })
    expect(res.status).toBe(200)
    expect(res.data?.some((r) => r.agentId === agent.id)).toBe(true)
  })

  test('a non-member cannot read an org\'s requests (404)', async () => {
    const orgId = await personalOrgId()
    const stranger = await h.clientFor('44444444-4444-4444-4444-444444444444', { email: 'stranger4@example.com' })
    const res = await stranger.api.organizations({ orgId }).requests.get()
    expect(res.status).toBe(404)
  })

  test("an org's request list excludes other orgs' requests (tenant isolation)", async () => {
    await newProject('iso')
    const agent = await newAgent('iso-bot')
    await h.api.agent.v1['scope-requests'].post({ scopes: ['db:read'] }, { headers: bearer(agent.apiKey) })
    const orgA = await personalOrgId()

    // A second org the same user also belongs to, with no projects/requests of its own.
    const [orgB] = await h.ctx.db.insert(organizations).values({ name: 'Org B' }).returning({ id: organizations.id })
    if (orgB === undefined) {
      throw new Error('failed to insert second org')
    }
    await h.ctx.db.insert(organizationMembers).values({ organizationId: orgB.id, userId: SYSTEM_USER_ID, role: 'member' })

    const inA = await h.api.api.organizations({ orgId: orgA }).requests.get({ query: { status: 'pending' } })
    expect(inA.data?.some((r) => r.agentId === agent.id)).toBe(true)
    const inB = await h.api.api.organizations({ orgId: orgB.id }).requests.get({ query: { status: 'pending' } })
    expect(inB.data).toEqual([])
  })
})

describe('org members', () => {
  const BOB = '88888888-8888-8888-8888-888888888888'

  test('GET /:orgId/members lists the roster (the founding owner)', async () => {
    const orgId = await personalOrgId()
    const res = await h.api.api.organizations({ orgId }).members.get()
    expect(res.status).toBe(200)
    expect(res.data?.length).toBe(1)
    expect(res.data?.[0]?.userId).toBe(SYSTEM_USER_ID)
    expect(res.data?.[0]?.role).toBe('owner')
    expect(res.data?.[0]?.email).toBe('system@walnut.cloud')
  })

  test('a non-member cannot list an org\'s members (404, no existence leak)', async () => {
    const orgId = await personalOrgId()
    const stranger = await h.clientFor('99999999-9999-9999-9999-999999999999', { email: 'stranger9@example.com' })
    expect((await stranger.api.organizations({ orgId }).members.get()).status).toBe(404)
  })

  test('removing a member drops them from the roster', async () => {
    const orgId = await personalOrgId()
    // Provision Bob (he gets his own personal org) and add him to this org as a plain member.
    const bob = await h.clientFor(BOB, { email: 'bob8@example.com' })
    await bob.api.organizations.get()
    await h.ctx.db.insert(organizationMembers).values({ organizationId: orgId, userId: BOB, role: 'member' })
    expect((await h.api.api.organizations({ orgId }).members.get()).data?.length).toBe(2)

    const rm = await h.api.api.organizations({ orgId }).members({ memberId: BOB }).delete()
    expect(rm.status).toBe(200)
    expect(rm.data).toEqual({ removed: true })

    const after = await h.api.api.organizations({ orgId }).members.get()
    expect(after.data?.length).toBe(1)
    expect(after.data?.some((m) => m.userId === BOB)).toBe(false)
  })

  test('removing one of two owners succeeds (only the *last* owner is protected)', async () => {
    const orgId = await personalOrgId()
    const bob = await h.clientFor(BOB, { email: 'bob8@example.com' })
    await bob.api.organizations.get()
    // A second owner alongside the founder, so neither is the "last" owner.
    await h.ctx.db.insert(organizationMembers).values({ organizationId: orgId, userId: BOB, role: 'owner' })

    const rm = await h.api.api.organizations({ orgId }).members({ memberId: BOB }).delete()
    expect(rm.status).toBe(200)
    const after = await h.api.api.organizations({ orgId }).members.get()
    expect(after.data?.length).toBe(1)
    expect(after.data?.[0]?.userId).toBe(SYSTEM_USER_ID)
  })

  test("removing the org's last owner is refused (400, would orphan it)", async () => {
    const orgId = await personalOrgId()
    const res = await h.api.api.organizations({ orgId }).members({ memberId: SYSTEM_USER_ID }).delete()
    expect(res.status).toBe(400)
    // The owner is still there.
    expect((await h.api.api.organizations({ orgId }).members.get()).data?.length).toBe(1)
  })

  test('removing a user who is not a member is 404', async () => {
    const orgId = await personalOrgId()
    const res = await h.api.api.organizations({ orgId }).members({ memberId: BOB }).delete()
    expect(res.status).toBe(404)
  })

  test('a non-member cannot remove anyone from the org (404)', async () => {
    const orgId = await personalOrgId()
    const stranger = await h.clientFor('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', { email: 'strangerA@example.com' })
    const res = await stranger.api.organizations({ orgId }).members({ memberId: SYSTEM_USER_ID }).delete()
    expect(res.status).toBe(404)
    // ...and the owner is untouched.
    expect((await h.api.api.organizations({ orgId }).members.get()).data?.length).toBe(1)
  })
})

describe('org invitations', () => {
  const INVITEE = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
  const OTHER = 'dddddddd-dddd-dddd-dddd-dddddddddddd'

  /** A shared (non-personal) org owned by the seeded system user — invites require one. */
  async function sharedOrg(): Promise<string> {
    const [org] = await h.ctx.db.insert(organizations).values({ name: 'Shared Org' }).returning({ id: organizations.id })
    if (org === undefined) {
      throw new Error('failed to create shared org')
    }
    await h.ctx.db.insert(organizationMembers).values({ organizationId: org.id, userId: SYSTEM_USER_ID, role: 'owner' })
    return org.id
  }

  async function createInvite(orgId: string): Promise<{ id: string; token: string }> {
    const res = await h.api.api.organizations({ orgId }).invitations.post({})
    const data = res.data
    if (data === null) {
      throw new Error(`createInvite failed: ${JSON.stringify(res.error?.value)}`)
    }
    return { id: data.id, token: data.token }
  }

  test('creating an invite returns a one-time token and stores only its hash', async () => {
    const orgId = await sharedOrg()
    const res = await h.api.api.organizations({ orgId }).invitations.post({})
    expect(res.status).toBe(200)
    expect(res.data?.status).toBe('pending')
    expect(res.data?.role).toBe('member')
    expect(res.data?.token?.startsWith('wln_inv_')).toBe(true)

    const id = res.data?.id
    if (id === undefined) {
      throw new Error('no invite id')
    }
    const [row] = await h.ctx.db.select().from(organizationInvitations).where(eq(organizationInvitations.id, id))
    // Only the hash (not the plaintext token) is persisted anywhere on the row.
    expect(row?.tokenHash).not.toBe(res.data?.token)
    expect(JSON.stringify(row)).not.toContain(res.data?.token ?? '')
  })

  test('invites can only be minted in shared orgs, not personal ones (400)', async () => {
    const orgId = await personalOrgId()
    const res = await h.api.api.organizations({ orgId }).invitations.post({})
    expect(res.status).toBe(400)
  })

  test('GET lists live invites (never leaking the token); revoke drops them from the list', async () => {
    const orgId = await sharedOrg()
    const inv = await createInvite(orgId)
    const listed = (await h.api.api.organizations({ orgId }).invitations.get()).data?.find((i) => i.id === inv.id)
    expect(listed).toBeDefined()
    // The list view exposes only a non-secret prefix — never the token or its hash.
    const fields = listed as Record<string, unknown> | undefined
    expect(fields?.token).toBeUndefined()
    expect(fields?.tokenHash).toBeUndefined()
    expect(typeof fields?.tokenPrefix).toBe('string')

    const rev = await h.api.api.organizations({ orgId }).invitations({ invitationId: inv.id }).delete()
    expect(rev.status).toBe(200)
    expect((await h.api.api.organizations({ orgId }).invitations.get()).data?.some((i) => i.id === inv.id)).toBe(false)
  })

  test('a non-member cannot create, list, or revoke invites (404)', async () => {
    const orgId = await sharedOrg()
    const inv = await createInvite(orgId)
    const stranger = await h.clientFor('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', { email: 'strangerE@example.com' })
    expect((await stranger.api.organizations({ orgId }).invitations.post({})).status).toBe(404)
    expect((await stranger.api.organizations({ orgId }).invitations.get()).status).toBe(404)
    expect(
      (await stranger.api.organizations({ orgId }).invitations({ invitationId: inv.id }).delete()).status,
    ).toBe(404)
  })

  test('previewing a link reports the org, role, and validity', async () => {
    const orgId = await sharedOrg()
    const { token } = await createInvite(orgId)
    const invitee = await h.clientFor(INVITEE, { email: 'invitee@example.com' })
    const res = await invitee.api.invitations({ token }).get()
    expect(res.status).toBe(200)
    expect(res.data?.organizationId).toBe(orgId)
    expect(res.data?.organizationName).toBe('Shared Org')
    expect(res.data?.role).toBe('member')
    expect(res.data?.state).toBe('valid')
    expect(res.data?.alreadyMember).toBe(false)
  })

  test('accepting a link joins the redeemer to the org with the invite role', async () => {
    const orgId = await sharedOrg()
    const { token } = await createInvite(orgId)
    const invitee = await h.clientFor(INVITEE, { email: 'invitee@example.com' })
    await invitee.api.organizations.get()

    const res = await invitee.api.invitations({ token }).accept.post()
    expect(res.status).toBe(200)
    expect(res.data?.organizationId).toBe(orgId)

    const joined = (await h.api.api.organizations({ orgId }).members.get()).data?.find((m) => m.userId === INVITEE)
    expect(joined?.role).toBe('member')
    // Real membership: the invitee can now read the org's projects.
    expect((await invitee.api.organizations({ orgId }).projects.get()).status).toBe(200)
  })

  test('a link is single-use: a second redeemer is refused (400) and the link reads spent', async () => {
    const orgId = await sharedOrg()
    const { token } = await createInvite(orgId)
    const first = await h.clientFor(INVITEE, { email: 'invitee@example.com' })
    const second = await h.clientFor(OTHER, { email: 'other@example.com' })
    await first.api.organizations.get()
    await second.api.organizations.get()

    expect((await first.api.invitations({ token }).accept.post()).status).toBe(200)
    expect((await second.api.invitations({ token }).accept.post()).status).toBe(400)
    expect((await h.api.api.organizations({ orgId }).members.get()).data?.some((m) => m.userId === OTHER)).toBe(false)
    expect((await second.api.invitations({ token }).get()).data?.state).toBe('accepted')
  })

  test('re-accepting as an already-joined member is an idempotent success (no duplicate)', async () => {
    const orgId = await sharedOrg()
    const { token } = await createInvite(orgId)
    const invitee = await h.clientFor(INVITEE, { email: 'invitee@example.com' })
    await invitee.api.organizations.get()
    expect((await invitee.api.invitations({ token }).accept.post()).status).toBe(200)
    expect((await invitee.api.invitations({ token }).accept.post()).status).toBe(200)
    expect(
      (await h.api.api.organizations({ orgId }).members.get()).data?.filter((m) => m.userId === INVITEE).length,
    ).toBe(1)
  })

  test('an expired link reads expired and cannot be accepted (400)', async () => {
    const orgId = await sharedOrg()
    // Seed a link that lapsed a second ago (no API mints expired links).
    const token = newInviteToken()
    await h.ctx.db.insert(organizationInvitations).values({
      organizationId: orgId,
      role: 'member',
      tokenHash: hashKey(token),
      tokenPrefix: keyPrefix(token),
      invitedByUserId: SYSTEM_USER_ID,
      expiresAt: new Date(Date.now() - 1000),
    })
    const invitee = await h.clientFor(INVITEE, { email: 'invitee@example.com' })
    await invitee.api.organizations.get()
    expect((await invitee.api.invitations({ token }).get()).data?.state).toBe('expired')
    expect((await invitee.api.invitations({ token }).accept.post()).status).toBe(400)
  })

  test('previewing as an already-joined member reports alreadyMember: true', async () => {
    const orgId = await sharedOrg()
    const { token } = await createInvite(orgId)
    const invitee = await h.clientFor(INVITEE, { email: 'invitee@example.com' })
    await invitee.api.organizations.get()
    expect((await invitee.api.invitations({ token }).accept.post()).status).toBe(200)
    const res = await invitee.api.invitations({ token }).get()
    expect(res.data?.alreadyMember).toBe(true)
    expect(res.data?.state).toBe('accepted')
  })

  test('accepting a revoked link is refused (400)', async () => {
    const orgId = await sharedOrg()
    const inv = await createInvite(orgId)
    await h.api.api.organizations({ orgId }).invitations({ invitationId: inv.id }).delete()
    const invitee = await h.clientFor(INVITEE, { email: 'invitee@example.com' })
    await invitee.api.organizations.get()
    expect((await invitee.api.invitations({ token: inv.token }).accept.post()).status).toBe(400)
  })

  test('an unknown token is 404 on preview and accept', async () => {
    const invitee = await h.clientFor(INVITEE, { email: 'invitee@example.com' })
    expect((await invitee.api.invitations({ token: 'wln_inv_deadbeef' }).get()).status).toBe(404)
    expect((await invitee.api.invitations({ token: 'wln_inv_deadbeef' }).accept.post()).status).toBe(404)
  })
})

describe('me + onboarding', () => {
  test('GET /api/me returns the user with onboarding not yet complete', async () => {
    const res = await h.api.api.me.get()
    expect(res.status).toBe(200)
    expect(res.data?.id).toBe(SYSTEM_USER_ID)
    expect(typeof res.data?.email).toBe('string')
    expect(res.data?.onboardingCompletedAt).toBeNull()
  })

  test('POST /api/me/onboarding/complete stamps completion and is idempotent', async () => {
    const first = await h.api.api.me.onboarding.complete.post()
    expect(first.status).toBe(200)
    const stamp = first.data?.onboardingCompletedAt
    expect(ms(stamp)).not.toBeNaN()

    // GET now reflects it…
    const me = await h.api.api.me.get()
    expect(ms(me.data?.onboardingCompletedAt)).toBe(ms(stamp))

    // …and completing again keeps the original timestamp (never rewrites it).
    const second = await h.api.api.me.onboarding.complete.post()
    expect(ms(second.data?.onboardingCompletedAt)).toBe(ms(stamp))
  })

  test('/api/me requires authentication', async () => {
    const res = await h.api.api.me.get({ headers: { authorization: '' } })
    expect(res.status).toBe(401)
  })
})

