export type ProviderKind = 'local' | 'neon'

export interface ProvisionedDatabase {
  /** Opaque id used to later destroy the database (Neon project id, or local db name). */
  providerProjectId: string
  /** Full Postgres connection string an agent's queries run against. */
  connectionUri: string
  /** Region identifier, when the provider reports one. */
  region: string | null
}

export interface DatabaseProvider {
  readonly kind: ProviderKind
  provision(input: { name: string }): Promise<ProvisionedDatabase>
  destroy(providerProjectId: string): Promise<void>
}
