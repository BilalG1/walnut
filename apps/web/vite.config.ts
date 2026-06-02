import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { localServiceUrl, portFor } from '@walnut/core/ports'
import { type Connect, defineConfig, loadEnv, type Plugin } from 'vite'

const here = dirname(fileURLToPath(import.meta.url))
// scripts/install.sh is the single source of truth; the site just publishes it.
const INSTALL_SCRIPT = resolve(here, '../../scripts/install.sh')

/**
 * Serve the CLI installer at `/install` so `curl -fsSL https://walnut.sh/install | bash`
 * works against this site. In dev/preview a middleware streams the shell script; at build
 * it's emitted as a static `install` asset at the site root, so it's matched before the
 * SPA history fallback instead of being rewritten to index.html. `text/plain` lets humans
 * read it in a browser before piping it to a shell (curl ignores the type anyway).
 */
function installScriptPlugin(): Plugin {
  const handler: Connect.NextHandleFunction = (_req, res) => {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache')
    res.end(readFileSync(INSTALL_SCRIPT, 'utf8'))
  }
  return {
    name: 'walnut-install-script',
    configureServer(server) {
      server.middlewares.use('/install', handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/install', handler)
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'install', source: readFileSync(INSTALL_SCRIPT, 'utf8') })
    },
  }
}

export default defineConfig(({ mode }) => {
  // Load env from the repo root so one .env serves api + web. Only VITE_* vars are
  // ever exposed to the client, so backend secrets in the same file stay private.
  // The empty third arg loads ALL vars (not just VITE_*) so we can read the
  // non-VITE_ PORT_PREFIX here in Node to derive ports.
  const env = loadEnv(mode, '../..', '')
  const prefix = env.PORT_PREFIX
  const webPort = portFor('web', prefix)

  // Default the dashboard's API base to the prefix-derived API port. If the user
  // pinned VITE_API_URL explicitly, leave it to Vite's own env injection (defining
  // the same key here would otherwise collide).
  const explicitApiUrl = env.VITE_API_URL?.trim()
  const apiUrl = explicitApiUrl || localServiceUrl('api', prefix)

  return {
    plugins: [react(), tailwindcss(), installScriptPlugin()],
    envDir: '../..',
    define: explicitApiUrl ? {} : { 'import.meta.env.VITE_API_URL': JSON.stringify(apiUrl) },
    server: { port: webPort, strictPort: true },
    preview: { port: webPort, strictPort: true },
  }
})
