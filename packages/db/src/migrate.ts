import { openDb } from './client.ts'
import { runMigrations } from './migrator.ts'

const url = process.env.DATABASE_URL
if (url === undefined || url === '') {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const { db, close } = openDb(url)
try {
  await runMigrations(db)
  console.log('Migrations applied')
} finally {
  await close()
}
