import { afterAll, beforeAll, beforeEach } from 'bun:test'
import { createHarness, type Harness } from './harness.ts'

/** The harness for the current test file. A live binding: `useHarness()` reassigns it in
 * `beforeAll`, and every importer (the helpers below and each e2e file) observes the new
 * value. Bun runs the files in a suite sequentially, so during a file's tests `h` points
 * at that file's harness. */
export let h: Harness

/** Register the standard e2e lifecycle for a test file: a fresh harness per file, reset to
 * a clean seed between cases, disposed at the end. Call once at the top of each e2e file.
 * Kept in one place so the per-file boilerplate (and any future shared setup) lives here. */
export function useHarness(): void {
  beforeAll(async () => {
    h = await createHarness()
  }, 30_000)
  afterAll(async () => {
    await h.dispose()
  }, 30_000)
  beforeEach(async () => {
    await h.reset()
  }, 15_000)
}

/** The shape of the API's machine-readable error bodies (the `error`/`message` envelope plus
 * the optional fields the scope and limit guards attach). */
export interface ErrorBody {
  error: string
  message: string
  missingScopes?: string[]
  requiredScopes?: string[]
  grantedScopes?: string[]
  limit?: string
  max?: number
}

export async function newProject(name = 'proj'): Promise<{ id: string }> {
  const res = await h.api.api.projects.post({ name })
  if (res.data === null) {
    throw new Error(`createProject failed: ${JSON.stringify(res.error?.value)}`)
  }
  return res.data
}

/** Create a grant-less agent in the seeded user's personal org. */
export async function newAgent(name = 'agent'): Promise<{ id: string; apiKey: string }> {
  const orgId = await personalOrgId()
  const res = await h.api.api.organizations({ orgId }).agents.post({ name })
  if (res.data === null) {
    throw new Error(`createAgent failed: ${JSON.stringify(res.error?.value)}`)
  }
  return res.data
}

export function bearer(apiKey: string): { authorization: string } {
  return { authorization: `Bearer ${apiKey}` }
}

/** Epoch ms for a date field. The in-memory treaty harness hands back Date objects where
 * real HTTP would yield ISO strings (the serializer contract); this compares either form. */
export function ms(v: string | Date | null | undefined): number {
  return v == null ? Number.NaN : new Date(v).getTime()
}

/** Helper: have an agent request scopes on a project and immediately approve them. */
export async function grant(
  apiKey: string,
  projectId: string,
  scopes: ('db:read' | 'db:write' | 'db:delete' | 'db:ddl')[],
): Promise<void> {
  const reqRes = await h.api.agent.v1['scope-requests'].post(
    { scopes, resourceType: 'project', resourceId: projectId },
    { headers: bearer(apiKey) },
  )
  const id = reqRes.data?.id
  if (id === undefined) {
    throw new Error(`scope request failed: ${JSON.stringify(reqRes.error?.value)}`)
  }
  await h.api.api['scope-requests']({ id }).approve.post()
}

/** The caller's personal org id (every user gets one on first auth). */
export async function personalOrgId(): Promise<string> {
  const res = await h.api.api.organizations.get()
  const org = res.data?.find((o) => o.isPersonal)
  if (org === undefined) {
    throw new Error(`no personal org: ${JSON.stringify(res.error?.value ?? res.data)}`)
  }
  return org.id
}
