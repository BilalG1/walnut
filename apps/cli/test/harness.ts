import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { treaty } from '@elysiajs/eden'
import { createApp, createContext, createTestAuth, ensureSeed, type OwnedContext } from '@walnut/api/testing'
import { createRateLimiter, SYSTEM_USER_ID } from '@walnut/core'
import { localS3Endpoint } from '@walnut/core/ports'
import { openDb, runMigrations } from '@walnut/db'
import { sql } from 'drizzle-orm'
import postgres from 'postgres'
import { run } from '../src/cli.ts'
import type { ApiClient } from '../src/client.ts'
import { deleteCredentials } from '../src/credentials.ts'
import type { CliResult } from '../src/output.ts'

// A dedicated metadata database + per-project db prefix so this suite is fully
// isolated from the api suite, which runs in parallel against the same cluster.
const ADMIN_URL = process.env.TEST_PG_ADMIN_URL ?? 'postgres://walnut:walnut@localhost:3002/postgres'
const TEST_DB = process.env.CLI_TEST_DB_NAME ?? 'walnut_test_cli'
const DB_PREFIX = 'clitest'

function withDatabase(adminUrl: string, db: string): string {
  const url = new URL(adminUrl)
  url.pathname = `/${db}`
  return url.toString()
}

const TEST_DB_URL = withDatabase(ADMIN_URL, TEST_DB)

function authHeader(key: string): { authorization: string } {
  return { authorization: `Bearer ${key}` }
}

async function ensureTestDatabase(): Promise<void> {
  const admin = postgres(ADMIN_URL, { max: 1, prepare: false })
  try {
    const rows = await admin`SELECT 1 FROM pg_database WHERE datname = ${TEST_DB}`
    if (rows.length === 0) {
      await admin.unsafe(`CREATE DATABASE "${TEST_DB}"`)
    }
  } finally {
    await admin.end({ timeout: 5 })
  }
}

/** Reset the metadata schema so freshly regenerated migrations apply cleanly. */
async function resetSchema(): Promise<void> {
  const client = postgres(TEST_DB_URL, { max: 1, prepare: false, onnotice: () => {} })
  try {
    // Evict any lingering sessions (e.g. a prior run still closing) so DROP SCHEMA
    // can't block on their locks; the lock_timeout then fails fast instead of hanging.
    await client.unsafe(
      'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()',
    )
    await client.unsafe("SET lock_timeout = '15s'")
    await client.unsafe('DROP SCHEMA IF EXISTS drizzle CASCADE')
    await client.unsafe('DROP SCHEMA IF EXISTS public CASCADE')
    await client.unsafe('CREATE SCHEMA public')
  } finally {
    await client.end({ timeout: 5 })
  }
}

/** Drop the per-project databases + roles this suite created (prefix-scoped, so it
 * never touches the api suite's `proj_*` artifacts). */
async function dropProjectArtifacts(): Promise<void> {
  const admin = postgres(ADMIN_URL, { max: 1, prepare: false })
  const prefix = `${DB_PREFIX}_`
  try {
    const dbs = await admin<{ datname: string }[]>`SELECT datname FROM pg_database WHERE datname ^@ ${prefix}`
    for (const { datname } of dbs) {
      // eslint-disable-next-line no-await-in-loop
      await admin`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ${datname} AND pid <> pg_backend_pid()`
      // eslint-disable-next-line no-await-in-loop
      await admin.unsafe(`DROP DATABASE IF EXISTS "${datname}"`)
    }
    const roles = await admin<{ rolname: string }[]>`SELECT rolname FROM pg_roles WHERE rolname ^@ ${prefix}`
    for (const { rolname } of roles) {
      // eslint-disable-next-line no-await-in-loop
      await admin.unsafe(`DROP OWNED BY "${rolname}"`)
      // eslint-disable-next-line no-await-in-loop
      await admin.unsafe(`DROP ROLE IF EXISTS "${rolname}"`)
    }
  } finally {
    await admin.end({ timeout: 5 })
  }
}

export interface RunOptions {
  key?: string
  stdin?: string
  /** Override the client factory — e.g. to simulate a transport failure. */
  makeClient?: (apiUrl: string, apiKey: string) => ApiClient
}

export interface SpawnResult {
  code: number
  stdout: string
  stderr: string
}

export interface MakeAgentOptions {
  scopes?: string[]
  projectName?: string
  agentName?: string
}

export interface CliHarness {
  ctx: OwnedContext
  /** Temp home directory where the CLI reads/writes its credentials file. */
  homeDir: string
  makeAgent: (opts?: MakeAgentOptions) => Promise<{ projectId: string; key: string }>
  /** Create an extra project in the seeded user's org (no agent) — for org-scoping tests. */
  makeProject: (name: string) => Promise<{ id: string }>
  /** Create a branch of a project (clone of its default) — for branch-targeting tests. */
  makeBranch: (projectId: string, name: string) => Promise<{ id: string; name: string }>
  /** Request + approve scopes for an agent. Targets `projectId` when given, else the
   * agent's default (sole) project. */
  grant: (key: string, scopes: string[], projectId?: string) => Promise<void>
  /** Run the CLI in-process against the real (in-memory) app — exercises routing, the
   * database and scope enforcement without a socket (the sandbox firewall blocks real
   * fetch, even to localhost). */
  run: (args: string[], opts?: RunOptions) => Promise<CliResult>
  /** Spawn the real from-source binary. Only for paths that never touch the network. */
  spawn: (args: string[], env?: Record<string, string>) => Promise<SpawnResult>
  reset: () => Promise<void>
  dispose: () => Promise<void>
}

export async function createCliHarness(): Promise<CliHarness> {
  await ensureTestDatabase()
  await resetSchema()

  const migrationHandle = openDb(TEST_DB_URL)
  try {
    await runMigrations(migrationHandle.db)
  } finally {
    await migrationHandle.close()
  }

  const { verifier, mintToken } = await createTestAuth()
  // Frozen-clock limiter + per-test reset (below) keeps rate limiting transparent to CLI tests,
  // which exercise CLI behavior, not the limits themselves.
  const rateLimiter = createRateLimiter(() => 1_000_000)
  const ctx = createContext(
    TEST_DB_URL,
    {
      kind: 'local',
      localAdminUrl: ADMIN_URL,
      localDbPrefix: DB_PREFIX,
    },
    {
      kind: 'local',
      endpoint: process.env.STORAGE_ENDPOINT?.trim() || localS3Endpoint(process.env.PORT_PREFIX),
      bucket: process.env.STORAGE_BUCKET?.trim() || 'walnut',
      accessKeyId: process.env.STORAGE_ACCESS_KEY_ID?.trim() || 'walnut',
      secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY?.trim() || 'walnutminio',
      region: 'auto',
    },
    verifier,
    rateLimiter,
  )
  await ctx.blobProvider.ensureBucket()
  const app = createApp(ctx)
  // Dashboard calls (project/agent creation, scope approval) run as the seeded user.
  const systemToken = await mintToken(SYSTEM_USER_ID, { email: 'system@walnut.cloud', name: 'System' })
  const api = treaty(app, { headers: authHeader(systemToken) })
  const cliEntry = `${import.meta.dir}/../src/index.ts`
  const homeDir = await mkdtemp(join(tmpdir(), 'walnut-cli-home-'))

  /** A client that talks to the in-memory app with the key applied to every call. */
  function inMemoryClient(_apiUrl: string, apiKey: string): ApiClient {
    return treaty(app, { headers: authHeader(apiKey) })
  }

  // Treaty's response-body types collapse across the package boundary, so cast the
  // `.data` we read to its known runtime shape.
  async function grant(key: string, scopes: string[], projectId?: string): Promise<void> {
    const body =
      projectId === undefined ? { scopes } : { scopes, resourceType: 'project' as const, resourceId: projectId }
    const req = await api.agent.v1['scope-requests'].post(body, { headers: authHeader(key) })
    const id = (req.data as { id: string } | null)?.id
    if (id === undefined) {
      throw new Error(`scope request failed: ${JSON.stringify(req.error?.value)}`)
    }
    await api.api['scope-requests']({ id }).approve.post()
  }

  async function makeProject(name: string): Promise<{ id: string }> {
    const proj = await api.api.projects.post({ name })
    const projData = proj.data as { id: string } | null
    if (projData === null) {
      throw new Error(`createProject failed: ${JSON.stringify(proj.error?.value)}`)
    }
    return projData
  }

  async function makeBranch(projectId: string, name: string): Promise<{ id: string; name: string }> {
    const res = await api.api.projects({ id: projectId }).branches.post({ name })
    const data = res.data as { id: string; name: string } | null
    if (data === null) {
      throw new Error(`createBranch failed: ${JSON.stringify(res.error?.value)}`)
    }
    return data
  }

  async function systemOrgId(): Promise<string> {
    const res = await api.api.organizations.get()
    const org = (res.data as { id: string; isPersonal: boolean }[] | null)?.find((o) => o.isPersonal)
    if (org === undefined) {
      throw new Error(`no personal org: ${JSON.stringify(res.error?.value)}`)
    }
    return org.id
  }

  // Agents are org-scoped and born grant-less; `scopes` is granted on the created project.
  async function makeAgent(opts: MakeAgentOptions = {}): Promise<{ projectId: string; key: string }> {
    const projData = await makeProject(opts.projectName ?? 'cli-proj')
    const orgId = await systemOrgId()
    const agent = await api.api.organizations({ orgId }).agents.post({ name: opts.agentName ?? 'cli-agent' })
    const agentData = agent.data as { apiKey: string } | null
    if (agentData === null) {
      throw new Error(`createAgent failed: ${JSON.stringify(agent.error?.value)}`)
    }
    if (opts.scopes !== undefined && opts.scopes.length > 0) {
      await grant(agentData.apiKey, opts.scopes, projData.id)
    }
    return { projectId: projData.id, key: agentData.apiKey }
  }

  function runCli(args: string[], opts: RunOptions = {}): Promise<CliResult> {
    // A key is supplied as the --api-key flag (the credentials file is exercised by
    // the dedicated login/logout tests).
    const finalArgs = opts.key === undefined ? args : [...args, '--api-key', opts.key]
    return run(finalArgs, {
      homeDir,
      readStdin: async () => opts.stdin ?? '',
      makeClient: opts.makeClient ?? inMemoryClient,
    })
  }

  async function spawn(args: string[], extraEnv: Record<string, string> = {}): Promise<SpawnResult> {
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) env[k] = v
    }
    // Point HOME at the temp dir so the real binary reads/writes creds there, never the
    // developer's real ~/.walnut.
    env.HOME = homeDir
    Object.assign(env, extraEnv)

    const proc = Bun.spawn(['bun', cliEntry, ...args], { env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { code, stdout: stdout.trim(), stderr: stderr.trim() }
  }

  async function reset(): Promise<void> {
    ctx.rateLimiter.reset()
    await ctx.db.execute(sql`TRUNCATE TABLE users, organizations RESTART IDENTITY CASCADE`)
    await ensureSeed(ctx)
    await deleteCredentials(homeDir)
  }

  async function dispose(): Promise<void> {
    await ctx.close()
    await dropProjectArtifacts()
    await rm(homeDir, { recursive: true, force: true })
  }

  return { ctx, homeDir, makeAgent, makeProject, makeBranch, grant, run: runCli, spawn, reset, dispose }
}
