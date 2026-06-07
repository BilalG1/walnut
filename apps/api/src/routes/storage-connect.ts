import type { Branch, Project } from '@walnut/db'
import { Elysia, t } from 'elysia'
import { extractBearer } from '../auth/bearer.ts'
import type { AppContext } from '../context.ts'
import { unauthorized } from '../errors.ts'
import { enforceRate } from '../rate-limit.ts'
import {
  commitUpload,
  createUpload,
  deleteObject,
  downloadObject,
  listStorageObjects,
  statObject,
} from '../services/storage.ts'
import { resolveStorageToken } from '../services/storage-tokens.ts'

/**
 * Owner-facing object-storage API (`/storage/v1/*`) — the surface behind the Storage tab's
 * "Connect" button. A user plugs a branch storage token (minted in the dashboard) into their own
 * application and gets FULL read/write/delete on that one branch's storage, addressed by `(path)`
 * alone (the token pins the branch — no project/branch params, unlike the agent API). This is the
 * object-storage analog of handing out a branch's owner DB connection string: it deliberately
 * bypasses the agent scope/approval loop because it's the user's own branch.
 *
 * It reuses the exact same storage service the agent + dashboard surfaces use (two-phase presigned
 * writes, nearest-ancestor-wins reads), so bytes never transit the API. It is NOT S3-compatible —
 * that's the future S3-gateway (Option A); this MVP speaks Walnut's own REST protocol.
 *
 * Kept a separate plugin from `/agent/v1/storage` (agent-key auth) so the two auth models stay
 * cleanly apart and this surface can later be swapped for the S3 gateway without touching agents.
 */
export function storageConnectRoutes(ctx: AppContext) {
  return new Elysia({ prefix: '/storage/v1' })
    .resolve(
      async ({
        headers,
      }: {
        headers: Record<string, string | undefined>
      }): Promise<{ branch: Branch; project: Project; tokenId: string }> => {
        const secret = extractBearer(headers.authorization)
        if (secret === undefined) {
          throw unauthorized('Missing storage token. Pass it as `Authorization: Bearer <token>`.')
        }
        const resolved = await resolveStorageToken(ctx, secret)
        if (resolved === undefined) {
          throw unauthorized('Invalid storage token.')
        }
        return { branch: resolved.branch, project: resolved.project, tokenId: resolved.token.id }
      },
    )
    .get(
      '/ls',
      async ({ branch, tokenId, query }) => {
        enforceRate(ctx.rateLimiter, 'storageConnectPerToken', tokenId)
        return listStorageObjects(ctx, branch, { prefix: query.prefix, after: query.after, limit: query.limit })
      },
      {
        query: t.Object({
          prefix: t.Optional(t.String()),
          after: t.Optional(t.String()),
          limit: t.Optional(t.Numeric({ minimum: 1 })),
        }),
      },
    )
    .get(
      '/stat',
      async ({ branch, tokenId, query }) => {
        enforceRate(ctx.rateLimiter, 'storageConnectPerToken', tokenId)
        return statObject(ctx, branch, query.path)
      },
      { query: t.Object({ path: t.String({ minLength: 1 }) }) },
    )
    .get(
      '/download',
      async ({ branch, tokenId, query }) => {
        enforceRate(ctx.rateLimiter, 'storageConnectPerToken', tokenId)
        return downloadObject(ctx, branch, query.path)
      },
      { query: t.Object({ path: t.String({ minLength: 1 }) }) },
    )
    .post(
      '/upload',
      async ({ branch, project, tokenId, body }) => {
        enforceRate(ctx.rateLimiter, 'storageConnectPerToken', tokenId)
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
          sha256: t.String(),
          size: t.Integer({ minimum: 0 }),
          contentType: t.Optional(t.String({ maxLength: 255 })),
        }),
      },
    )
    .post(
      '/commit',
      async ({ branch, project, tokenId, body }) => {
        enforceRate(ctx.rateLimiter, 'storageConnectPerToken', tokenId)
        return commitUpload(ctx, project, branch, { path: body.path })
      },
      { body: t.Object({ path: t.String({ minLength: 1 }) }) },
    )
    .post(
      '/delete',
      async ({ branch, tokenId, body }) => {
        enforceRate(ctx.rateLimiter, 'storageConnectPerToken', tokenId)
        return deleteObject(ctx, branch, { path: body.path })
      },
      { body: t.Object({ path: t.String({ minLength: 1 }) }) },
    )
}
