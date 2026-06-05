import type { ScopeWithExpiry } from '@walnut/core'
import type { Agent, Branch, Project } from '@walnut/db'
import { Elysia, t } from 'elysia'
import type { AppContext } from '../context.ts'
import { enforceRate } from '../rate-limit.ts'
import { agentScopesForBranch, resolveAgentProject } from '../services/agents.ts'
import { resolveBranch } from '../services/projects.ts'
import { agentBearerResolver } from './agent-bearer.ts'
import {
  assertStorageScope,
  commitUpload,
  createUpload,
  deleteObject,
  downloadObject,
  listStorageObjects,
  statObject,
} from '../services/storage.ts'
import { uuid } from '../validation.ts'

/** Resolve the target project (explicit or the agent's sole one), the target branch (named or
 * default), and the agent's effective scopes on it — the union of its project + branch grants. */
async function resolveTarget(
  ctx: AppContext,
  agent: Agent,
  projectId: string | undefined,
  branchName: string | undefined,
): Promise<{ project: Project; branch: Branch; scopeRows: ScopeWithExpiry[] }> {
  const project = await resolveAgentProject(ctx, agent, projectId)
  const branch = await resolveBranch(ctx, project.id, branchName)
  const scopeRows = await agentScopesForBranch(ctx, agent.id, project.id, branch.id)
  return { project, branch, scopeRows }
}

/**
 * Agent-facing object-storage API (`/agent/v1/storage/*`). Mirrors the db-query route: bearer
 * auth, the same `--project`/`--branch` resolution and defaulting, the same machine-readable 403
 * that drives the scope-request approval loop. Agents only ever name `(branch, path)` — physical
 * keys are never exposed — and up/downloads go through short-TTL presigned URLs, so bytes never
 * transit the API. Authorization is enforced here (the API is the sole layer for blobs), per op.
 */
export function storageApiRoutes(ctx: AppContext) {
  return new Elysia({ prefix: '/agent/v1/storage' })
    .resolve(agentBearerResolver(ctx))
    .get(
      '/ls',
      async ({ agent, query }) => {
        enforceRate(ctx.rateLimiter, 'storagePerAgent', agent.id)
        const { branch, scopeRows } = await resolveTarget(ctx, agent, query.projectId, query.branch)
        assertStorageScope(scopeRows, 'storage:read')
        return listStorageObjects(ctx, branch, {
          prefix: query.prefix,
          after: query.after,
          limit: query.limit,
        })
      },
      {
        query: t.Object({
          prefix: t.Optional(t.String()),
          after: t.Optional(t.String()),
          limit: t.Optional(t.Numeric({ minimum: 1 })),
          projectId: t.Optional(uuid),
          branch: t.Optional(t.String()),
        }),
      },
    )
    .get(
      '/stat',
      async ({ agent, query }) => {
        enforceRate(ctx.rateLimiter, 'storagePerAgent', agent.id)
        const { branch, scopeRows } = await resolveTarget(ctx, agent, query.projectId, query.branch)
        assertStorageScope(scopeRows, 'storage:read')
        return statObject(ctx, branch, query.path)
      },
      {
        query: t.Object({
          path: t.String({ minLength: 1 }),
          projectId: t.Optional(uuid),
          branch: t.Optional(t.String()),
        }),
      },
    )
    // Resolve `path` and mint a short-TTL presigned GET; the client downloads the bytes directly.
    .get(
      '/download',
      async ({ agent, query }) => {
        enforceRate(ctx.rateLimiter, 'storagePerAgent', agent.id)
        const { branch, scopeRows } = await resolveTarget(ctx, agent, query.projectId, query.branch)
        assertStorageScope(scopeRows, 'storage:read')
        return downloadObject(ctx, branch, query.path)
      },
      {
        query: t.Object({
          path: t.String({ minLength: 1 }),
          projectId: t.Optional(uuid),
          branch: t.Optional(t.String()),
        }),
      },
    )
    // Two-phase write, phase one: stage a pending row + presigned PUT, or commit immediately on a
    // content-addressed dedup hit.
    .post(
      '/upload',
      async ({ agent, body }) => {
        enforceRate(ctx.rateLimiter, 'storagePerAgent', agent.id)
        const { project, branch, scopeRows } = await resolveTarget(ctx, agent, body.projectId, body.branch)
        assertStorageScope(scopeRows, 'storage:write')
        return createUpload(ctx, project, branch, {
          path: body.path,
          sha256: body.sha256,
          size: body.size,
          contentType: body.contentType,
        })
      },
      {
        body: t.Object({
          path: t.String({ minLength: 1 }),
          /** Client-computed sha256 of the bytes (the content address). */
          sha256: t.String(),
          /** Client-declared byte length; the real size is re-captured by HEAD at commit. */
          size: t.Integer({ minimum: 0 }),
          contentType: t.Optional(t.String({ maxLength: 255 })),
          projectId: t.Optional(uuid),
          branch: t.Optional(t.String()),
        }),
      },
    )
    // Two-phase write, phase two: HEAD-verify the uploaded bytes and flip the row to committed.
    .post(
      '/commit',
      async ({ agent, body }) => {
        enforceRate(ctx.rateLimiter, 'storagePerAgent', agent.id)
        const { branch, scopeRows } = await resolveTarget(ctx, agent, body.projectId, body.branch)
        assertStorageScope(scopeRows, 'storage:write')
        return commitUpload(ctx, branch, { path: body.path })
      },
      {
        body: t.Object({
          path: t.String({ minLength: 1 }),
          projectId: t.Optional(uuid),
          branch: t.Optional(t.String()),
        }),
      },
    )
    // Delete `path` on the branch by writing a tombstone (bytes are shared; GC reclaims them).
    .post(
      '/delete',
      async ({ agent, body }) => {
        enforceRate(ctx.rateLimiter, 'storagePerAgent', agent.id)
        const { branch, scopeRows } = await resolveTarget(ctx, agent, body.projectId, body.branch)
        assertStorageScope(scopeRows, 'storage:delete')
        return deleteObject(ctx, branch, { path: body.path })
      },
      {
        body: t.Object({
          path: t.String({ minLength: 1 }),
          projectId: t.Optional(uuid),
          branch: t.Optional(t.String()),
        }),
      },
    )
}
