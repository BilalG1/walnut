import { type AgentScope, hashKey, keyPrefix, newAgentKey, parseScopes } from '@walnut/core'
import { agents, type Agent } from '@walnut/db'
import { desc, eq } from 'drizzle-orm'
import type { AppContext } from '../context.ts'
import { HttpError, notFound } from '../errors.ts'
import { getProject } from './projects.ts'

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
  await getProject(ctx, projectId)
  const apiKey = newAgentKey()
  const [created] = await ctx.db
    .insert(agents)
    .values({
      projectId,
      name: input.name,
      keyHash: hashKey(apiKey),
      keyPrefix: keyPrefix(apiKey),
      scopes: [],
    })
    .returning()
  if (created === undefined) {
    throw new HttpError(500, { error: 'internal_error', message: 'Failed to create agent.' })
  }
  return { agent: created, apiKey }
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
  await ctx.db.delete(agents).where(eq(agents.id, agent.id))
}

export async function findAgentByKey(ctx: AppContext, key: string): Promise<Agent | undefined> {
  const [row] = await ctx.db.select().from(agents).where(eq(agents.keyHash, hashKey(key))).limit(1)
  return row
}

/** Merge new scopes into an agent's grant, validated and deduplicated. */
export async function grantScopes(ctx: AppContext, agent: Agent, add: readonly AgentScope[]): Promise<Agent> {
  const merged = parseScopes([...agent.scopes, ...add])
  const [updated] = await ctx.db.update(agents).set({ scopes: merged }).where(eq(agents.id, agent.id)).returning()
  return updated ?? agent
}
