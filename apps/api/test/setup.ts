// Test preload (see ../bunfig.toml). Bun's fetch + S3Client route through an HTTP proxy
// when one is configured — e.g. the `sfw` sandbox wrapper that aliases `bun` locally. The
// e2e harness only ever talks to LOCAL services (the docker Postgres and MinIO), so opt
// every outbound request out of the proxy up front. This is a no-op when no proxy is set
// (CI, a plain machine), so `bun run check` works the same everywhere — without it the
// storage suites fail in beforeAll with `Failed to create bucket "walnut": 405` because the
// proxy rejects the bucket-create PUT to MinIO.
// Keep in sync with apps/cli/test/setup.ts.
process.env.NO_PROXY ??= '*'
process.env.no_proxy ??= '*'
for (const v of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) {
  process.env[v] = ''
}
