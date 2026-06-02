import { localPostgresUrl } from '@walnut/core/ports'
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  strict: true,
  verbose: true,
  dbCredentials: {
    url: process.env.DATABASE_URL?.trim() || localPostgresUrl({ database: 'walnut', prefix: process.env.PORT_PREFIX }),
  },
})
