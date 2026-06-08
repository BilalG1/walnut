// Test preload (see ../bunfig.toml). The cli e2e harness boots the real API in-memory,
// which provisions a MinIO bucket on startup (ensureBucket). Bun's fetch + S3Client route
// through an HTTP proxy when one is configured — e.g. the `sfw` sandbox wrapper that aliases
// `bun` locally — and the proxy rejects those local calls (bucket-create PUT 405, S3 stat
// UnknownError). Our e2e traffic is all LOCAL (docker Postgres + MinIO), so clear the proxy
// up front. A no-op when no proxy is set (CI, a plain machine), so `bun run check` works the
// same everywhere. Keep in sync with apps/api/test/setup.ts.
process.env.NO_PROXY ??= '*'
process.env.no_proxy ??= '*'
for (const v of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
  process.env[v] = ''
}
