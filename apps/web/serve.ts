/**
 * Production static server for the built dashboard (`apps/web/dist`).
 *
 * Railway has no static-serving primitive we want to depend on (and disabled its CDN), so we
 * serve the Vite build ourselves with Bun — keeping the stack all-Bun and putting Cloudflare in
 * front for the CDN. The contract is a standard SPA host:
 *   - real files win first, so content-hashed `/assets/*` and the `/install` script (emitted by
 *     the build at `dist/install`, see vite.config.ts) resolve directly, never rewritten;
 *   - a missing `/assets/*` file is a real 404 (masking it with the HTML shell would surface as
 *     a confusing MIME/parse error); every other unknown path falls back to `index.html` so
 *     client-side routes deep-link;
 *   - binds `$PORT` (Railway injects it), defaulting to the dev web port.
 *
 * Run with `bun run start` (see package.json). It's a server entrypoint, not part of the bundle.
 */
import { join, normalize } from 'node:path'
import { portFor } from '@walnut/core/ports'

// Resolve `dist/` relative to this file so the cwd Railway runs us from doesn't matter.
const DIST = join(import.meta.dir, 'dist')
const INDEX = join(DIST, 'index.html')
const PORT = process.env.PORT ? Number(process.env.PORT) : portFor('web', process.env.PORT_PREFIX)

/** Cache hashed assets forever (their name changes on content change); keep entry points fresh. */
function cacheControl(relPath: string): string {
  return relPath.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const { pathname } = new URL(req.url)
    // Decode + normalize, then strip any leading `../` so a crafted path can't escape DIST.
    const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.(\/|\\|$))+/, '').replace(/^\/+/, '')
    const candidate = rel === '' ? INDEX : join(DIST, rel)
    if (candidate.startsWith(DIST)) {
      const asset = Bun.file(candidate)
      if (await asset.exists()) {
        return new Response(asset, { headers: { 'cache-control': cacheControl(rel) } })
      }
    }
    // A missing content-hashed asset is a genuine 404 — never mask it with the HTML shell, which
    // the browser would then fail to parse as JS/CSS. Only true navigation routes fall through.
    if (rel.startsWith('assets/')) {
      return new Response('Not found', { status: 404 })
    }
    // SPA history fallback — unknown route, hand back the shell.
    return new Response(Bun.file(INDEX), { headers: { 'cache-control': 'no-cache' } })
  },
})

console.log(`Walnut web (static) listening on http://localhost:${server.port}`)
