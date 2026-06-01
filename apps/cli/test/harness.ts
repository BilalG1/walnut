import { treaty } from '@elysiajs/eden'
import { createApp, createContext, ensureSeed, type OwnedContext } from '@walnut/api/testing'
import { openDb, runMigrations } from '@walnut/db'
import { sql } from 'drizzle-orm'
import postgres from 'postgres'
import { run } from '../src/cli.ts'
import type { ApiClient } from '../src/client.ts'
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
  makeAgent: (opts?: MakeAgentOptions) => Promise<{ projectId: string; key: string }>
  grant: (key: string, scopes: string[]) => Promise<void>
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

  const migrationHandle = openDb(TEST_DB_URL)
  try {
    await runMigrations(migrationHandle.db)
  } finally {
    await migrationHandle.close()
  }

  const ctx = createContext(TEST_DB_URL, {
    kind: 'local',
    localAdminUrl: ADMIN_URL,
    localDbPrefix: DB_PREFIX,
  })
  const app = createApp(ctx)
  const api = treaty(app)
  const cliEntry = `${import.meta.dir}/../src/index.ts`

  /** A client that talks to the in-memory app with the key applied to every call. */
  function inMemoryClient(_apiUrl: string, apiKey: string): ApiClient {
    return treaty(app, { headers: authHeader(apiKey) })
  }

  // Treaty's response-body types collapse across the package boundary, so cast the
  // `.data` we read to its known runtime shape.
  async function grant(key: string, scopes: string[]): Promise<void> {
    const req = await api.agent.v1['scope-requests'].post({ scopes }, { headers: authHeader(key) })
    const id = (req.data as { id: string } | null)?.id
    if (id === undefined) {
      throw new Error(`scope request failed: ${JSON.stringify(req.error?.value)}`)
    }
    await api.api['scope-requests']({ id }).approve.post()
  }

  async function makeAgent(opts: MakeAgentOptions = {}): Promise<{ projectId: string; key: string }> {
    const proj = await api.api.projects.post({ name: opts.projectName ?? 'cli-proj' })
    const projData = proj.data as { id: string } | null
    if (projData === null) {
      throw new Error(`createProject failed: ${JSON.stringify(proj.error?.value)}`)
    }
    const agent = await api.api.projects({ id: projData.id }).agents.post({ name: opts.agentName ?? 'cli-agent' })
    const agentData = agent.data as { apiKey: string } | null
    if (agentData === null) {
      throw new Error(`createAgent failed: ${JSON.stringify(agent.error?.value)}`)
    }
    if (opts.scopes !== undefined && opts.scopes.length > 0) {
      await grant(agentData.apiKey, opts.scopes)
    }
    return { projectId: projData.id, key: agentData.apiKey }
  }

  function runCli(args: string[], opts: RunOptions = {}): Promise<CliResult> {
    const env: Record<string, string | undefined> = { WALNUT_API_URL: 'http://in-memory' }
    if (opts.key !== undefined) {
      env.WALNUT_API_KEY = opts.key
    }
    return run(args, {
      env,
      readStdin: async () => opts.stdin ?? '',
      makeClient: opts.makeClient ?? inMemoryClient,
    })
  }

  async function spawn(args: string[], extraEnv: Record<string, string> = {}): Promise<SpawnResult> {
    const env: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) {
      if (v !== undefined) env[k] = v
    }
    delete env.WALNUT_API_KEY
    delete env.WALNUT_API_URL
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
    await ctx.db.execute(sql`TRUNCATE TABLE users RESTART IDENTITY CASCADE`)
    await ensureSeed(ctx)
  }

  async function dispose(): Promise<void> {
    await ctx.close()
    await dropProjectArtifacts()
  }

  return { ctx, makeAgent, grant, run: runCli, spawn, reset, dispose }
}
