import postgres from 'postgres'

/**
 * Drop and recreate the platform metadata database from scratch. Pre-launch
 * convenience: there's no data to preserve, so the fastest way to adopt a reshaped
 * schema is to start the dev database over (then `db:migrate`). Tests never use this
 * — they manage `walnut_test` themselves.
 */

const target = process.env.DATABASE_URL
if (target === undefined || target === '') {
  console.error('DATABASE_URL is not set')
  process.exit(1)
}

const adminUrl = process.env.LOCAL_PG_ADMIN_URL
if (adminUrl === undefined || adminUrl === '') {
  console.error('LOCAL_PG_ADMIN_URL is not set')
  process.exit(1)
}

const dbName = new URL(target).pathname.replace(/^\//, '')
// Identifier goes into raw SQL below, so refuse anything that isn't a plain name.
if (!/^[A-Za-z0-9_]+$/.test(dbName)) {
  console.error(`Refusing to reset unsafe database name: ${dbName}`)
  process.exit(1)
}

const admin = postgres(adminUrl, { max: 1, prepare: false, onnotice: () => {} })
try {
  await admin.unsafe(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`)
  await admin.unsafe(`CREATE DATABASE "${dbName}"`)
  console.log(`Reset database "${dbName}" (now empty — run db:migrate to apply the schema)`)
} finally {
  await admin.end({ timeout: 5 })
}
