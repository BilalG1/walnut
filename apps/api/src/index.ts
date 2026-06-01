import { createApp } from './app.ts'
import { createContext } from './context.ts'
import { loadEnv } from './env.ts'
import { ensureSeed } from './seed.ts'

const env = loadEnv()
const ctx = createContext(env.databaseUrl, env.provider)

await ensureSeed(ctx)

const app = createApp(ctx, { corsOrigins: env.corsOrigins })
app.listen(env.port)

console.log(`🌰 Walnut API listening on http://localhost:${env.port} (provider: ${ctx.provider.kind})`)
