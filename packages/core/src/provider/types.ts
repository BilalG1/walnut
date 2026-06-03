export type ProviderKind = 'local' | 'neon'

/** One provisioned database — the unit a *branch* maps to. Every branch (including a
 * project's default `main`) has its own database with its own connection. */
export interface ProvisionedDatabase {
  /** Opaque id used to later destroy this branch's database (Neon branch id, or local db name). */
  providerBranchId: string
  /** Full Postgres connection string for this branch's database (the owner connection). */
  connectionUri: string
  /** Region identifier, when the provider reports one. */
  region: string | null
}

/** A freshly provisioned project: the provider-side container (when the provider has one)
 * plus its default branch's database. */
export interface ProvisionedProject {
  /** The provider's container id (a Neon project id). `null` for flat providers (local) that
   * have no container — there, branches are independent databases torn down one by one. */
  providerProjectId: string | null
  /** The project's default (`main`) branch database. */
  defaultBranch: ProvisionedDatabase
}

export interface CreateBranchInput {
  /** The provider container the branch belongs to (`null` for flat providers). */
  providerProjectId: string | null
  /** Human name for the branch (providers that name branches use it). */
  name: string
  /** Branch to copy from (Neon copy-on-write parent / local `TEMPLATE`), or `null` for an
   * empty database. */
  fromProviderBranchId: string | null
}

export interface DestroyBranchInput {
  providerProjectId: string | null
  providerBranchId: string
}

export interface DatabaseProvider {
  readonly kind: ProviderKind
  /** Create a project: its container (if any) and its default branch database. */
  provisionProject(input: { name: string }): Promise<ProvisionedProject>
  /** Create a new branch database, optionally copied from a parent branch. */
  createBranch(input: CreateBranchInput): Promise<ProvisionedDatabase>
  /** Destroy a single branch's database (and its cluster-global roles, for flat providers). */
  destroyBranch(input: DestroyBranchInput): Promise<void>
  /** Destroy a whole container and everything in it. Only meaningful for container providers
   * (Neon); flat providers (local) have no container, so the caller tears down each branch. */
  destroyProject(providerProjectId: string): Promise<void>
}
