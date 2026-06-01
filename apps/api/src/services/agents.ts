import {
  type AgentScope,
  createAgentRole,
  dropAgentRole,
  hashKey,
  keyPrefix,
  newAgentKey,
  parseScopes,
  syncAgentScopes,
} from '@walnut/core'
import { agents, type Agent } from '@walnut/db'
import { desc, eq } from 'drizzle-orm'
import type { AppContext } from '../context.ts'
import { HttpError, notFound } from '../errors.ts'
import { getProject, getProjectInternal } from './projects.ts'

export async function listAgents(ctx: AppContext, projectId: string): Promise<Agent[]> {
  await getProject(ctx, projectId)
  return ctx.db.select().from(agents).where(eq(agents.projectId, projectId)).orderBy(desc(agents.createdAt))
}

export interface CreatedAgent {
  agent: Agent
  /** Plaintext API key — returned only once, never persisted. */
  apiKey: string
}

export async function createAgent(
  ctx: AppContext,
  projectId: string,
  input: { name: string },
): Promise<CreatedAgent> {
  const project = await getProject(ctx, projectId)
  if (project.connectionUri === null) {
    throw new HttpError(409, {
      error: 'project_not_ready',
      message: `Project is "${project.status}"; cannot create an agent until its database is provisioned.`,
    })
  }

  // Provision the agent's restricted Postgres role up front; its queries run over
  // this connection, never the project owner connection.
  const { role, connectionUri } = await createAgentRole(project.connectionUri)

  const apiKey = newAgentKey()
  let created: Agent | undefined
  try {
    ;[created] = await ctx.db
      .insert(agents)
      .values({
        projectId,
        name: input.name,
        keyHash: hashKey(apiKey),
        keyPrefix: keyPrefix(apiKey),
        scopes: [],
        dbRole: role,
        connectionUri,
      })
      .returning()
  } catch (err) {
    // Roll back the just-created role on any insert failure (throw or empty result).
    await rollbackAgentRole(project.connectionUri, role)
    throw err
  }
  if (created === undefined) {
    await rollbackAgentRole(project.connectionUri, role)
    throw new HttpError(500, { error: 'internal_error', message: 'Failed to create agent.' })
  }
  return { agent: created, apiKey }
}

/** Best-effort drop of an agent role during error recovery; logs but never throws. */
async function rollbackAgentRole(ownerUri: string, role: string): Promise<void> {
  await dropAgentRole(ownerUri, role).catch((e) => {
    console.error(`Failed to roll back orphaned agent role ${role}:`, e)
  })
}

export async function getAgent(ctx: AppContext, id: string): Promise<Agent> {
  const [row] = await ctx.db.select().from(agents).where(eq(agents.id, id)).limit(1)
  if (row === undefined) {
    throw notFound('Agent')
  }
  // Confirm the agent's project belongs to the caller.
  await getProject(ctx, row.projectId)
  return row
}

export async function deleteAgent(ctx: AppContext, id: string): Promise<void> {
  const agent = await getAgent(ctx, id)
  if (agent.dbRole !== null) {
    const project = await getProjectInternal(ctx, agent.projectId)
    if (project.connectionUri !== null) {
      // Best-effort: still remove the metadata row even if the role teardown fails,
      // matching deleteProject's philosophy (don't strand the user's delete).
      await dropAgentRole(project.connectionUri, agent.dbRole).catch((e) => {
        console.error(`Failed to drop Postgres role for agent ${agent.id}:`, e)
      })
    }
  }
  await ctx.db.delete(agents).where(eq(agents.id, agent.id))
}

export async function findAgentByKey(ctx: AppContext, key: string): Promise<Agent | undefined> {
  const [row] = await ctx.db.select().from(agents).where(eq(agents.keyHash, hashKey(key))).limit(1)
  return row
}

/** Merge new scopes into an agent's grant, validated and deduplicated. Also
 * reconciles the agent's Postgres role memberships so the database engine enforces
 * the new grant. */
export async function grantScopes(ctx: AppContext, agent: Agent, add: readonly AgentScope[]): Promise<Agent> {
  const merged = parseScopes([...agent.scopes, ...add])
  const [updated] = await ctx.db.update(agents).set({ scopes: merged }).where(eq(agents.id, agent.id)).returning()
  const result = updated ?? agent

  if (result.dbRole !== null) {
    const project = await getProjectInternal(ctx, result.projectId)
    if (project.connectionUri !== null) {
      await syncAgentScopes(project.connectionUri, result.dbRole, merged)
    }
  }
  return result
}
