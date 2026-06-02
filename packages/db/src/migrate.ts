import { localPostgresUrl } from '@walnut/core/ports'
import { openDb } from './client.ts'
import { runMigrations } from './migrator.ts'

// Defaults to the local docker Postgres derived from PORT_PREFIX; set DATABASE_URL
// to target a remote/Neon metadata DB.
const url = process.env.DATABASE_URL?.trim() || localPostgresUrl({ database: 'walnut', prefix: process.env.PORT_PREFIX })

const { db, close } = openDb(url)
try {
  await runMigrations(db)
  console.log('Migrations applied')
} finally {
  await close()
}
