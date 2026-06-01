import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema.ts'

export type Schema = typeof schema
export type Database = PostgresJsDatabase<Schema>

export interface DbHandle {
  db: Database
  close: () => Promise<void>
}

/** Open a pooled connection to the platform metadata database. */
export function openDb(connectionString: string): DbHandle {
  const client = postgres(connectionString, { max: 10, prepare: false, onnotice: () => {} })
  const db = drizzle(client, { schema })
  return {
    db,
    close: () => client.end({ timeout: 5 }),
  }
}
