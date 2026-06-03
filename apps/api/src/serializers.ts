import { type AgentScope, effectiveScopes, type ScopeWithExpiry } from '@walnut/core'
import type { Agent, AgentGrant, Branch, Organization, Project, QueryEvent, ScopeRequest, User } from '@walnut/db'

/** The authenticated user's own profile (`GET /api/me`). `onboardingCompletedAt` drives
 * the first-run routing and sidebar gating; null means onboarding isn't finished. */
export interface MeView {
  id: string
  email: string
  onboardingCompletedAt: string | null
}

export function toMeView(user: User): MeView {
  return {
    id: user.id,
    email: user.email,
    onboardingCompletedAt: user.onboardingCompletedAt === null ? null : user.onboardingCompletedAt.toISOString(),
  }
}

/** A grant with its scope rows (each carrying an optional expiry) — what the serializers
 * receive from the services. */
type GrantWithScopes = AgentGrant & { scopes: ScopeWithExpiry[] }

export interface ProjectSummary {
  id: string
  name: string
  provider: string
  status: string
  error: string | null
  createdAt: string
}

export interface ProjectDetail extends ProjectSummary {
  connectionUri: string | null
}

export interface AgentView {
  id: string
  organizationId: string
  name: string
  keyPrefix: string
  scopes: string[]
  createdAt: string
}

export interface AgentWithKey extends AgentView {
  apiKey: string
}

export interface ScopeRequestView {
  id: string
  agentId: string
  organizationId: string
  resourceType: string
  resourceId: string
  scopes: string[]
  reason: string | null
  /** Requested time-box in seconds (null = permanent). */
  expiresInSeconds: number | null
  status: string
  createdAt: string
  resolvedAt: string | null
}

export function toProjectSummary(p: Project): ProjectSummary {
  return {
    id: p.id,
    name: p.name,
    provider: p.provider,
    status: p.status,
    error: p.error,
    createdAt: p.createdAt.toISOString(),
  }
}

/** Project detail plus the owner connection of its default branch (the database the dashboard
 * data viewer and "Connection" panel point at). `connectionUri` is null until provisioned. */
export function toProjectDetail(p: Project, connectionUri: string | null): ProjectDetail {
  return { ...toProjectSummary(p), connectionUri }
}

/** An agent's effective scopes: the deduplicated union of its non-expired scopes across
 * all grants. Expired scopes drop out, so the dashboard shows live access. */
export function agentScopeUnion(grants: readonly GrantWithScopes[], now: Date = new Date()): AgentScope[] {
  return effectiveScopes(grants.flatMap((g) => g.scopes), now)
}

export function toAgentView(agent: Agent, grants: readonly GrantWithScopes[]): AgentView {
  return {
    id: agent.id,
    organizationId: agent.organizationId,
    name: agent.name,
    keyPrefix: agent.keyPrefix,
    scopes: agentScopeUnion(grants),
    createdAt: agent.createdAt.toISOString(),
  }
}

export function toScopeRequestView(r: ScopeRequest): ScopeRequestView {
  return {
    id: r.id,
    agentId: r.agentId,
    organizationId: r.organizationId,
    resourceType: r.resourceType,
    resourceId: r.resourceId,
    scopes: r.scopes,
    reason: r.reason,
    expiresInSeconds: r.expiresInSeconds,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    resolvedAt: r.resolvedAt === null ? null : r.resolvedAt.toISOString(),
  }
}

export interface OrgSummary {
  id: string
  name: string
  isPersonal: boolean
  /** The caller's role in this org (owner/admin/member). */
  role: string
  createdAt: string
}

export function toOrgSummary(org: Organization, role: string): OrgSummary {
  return {
    id: org.id,
    name: org.name,
    isPersonal: org.isPersonal,
    role,
    createdAt: org.createdAt.toISOString(),
  }
}

/** A project as shown on the org home: summary plus the at-a-glance counts the cards display. */
export interface OrgProjectSummary extends ProjectSummary {
  agentCount: number
  pendingRequestCount: number
  defaultBranch: string | null
}

export function toOrgProjectSummary(
  p: Project,
  extra: { agentCount: number; pendingRequestCount: number; defaultBranch: string | null },
): OrgProjectSummary {
  return { ...toProjectSummary(p), ...extra }
}

/** One scope held on a grant, as shown in the org roster: the scope and when it lapses
 * (`expiresAt` null = permanent). */
export interface ScopeGrantView {
  scope: string
  expiresAt: string | null
}

/** One of an agent's grants, as shown in the org roster: the resource it applies to (with
 * a resolved project name when known) and the live (non-expired) scopes held there, each
 * with its expiry. */
export interface OrgAgentGrantView {
  resourceType: string
  resourceId: string
  projectName: string | null
  scopes: ScopeGrantView[]
}

/** An agent in the org-wide roster: its view plus a per-resource breakdown of its access
 * (an org-scoped agent may reach several projects, each with its own scopes). */
export interface OrgAgentView extends AgentView {
  grants: OrgAgentGrantView[]
}

export function toOrgAgentView(
  agent: Agent,
  grants: readonly GrantWithScopes[],
  projectNames: Readonly<Record<string, string>>,
  now: Date = new Date(),
): OrgAgentView {
  const isLive = (s: ScopeWithExpiry): boolean => s.expiresAt === null || s.expiresAt.getTime() > now.getTime()
  return {
    ...toAgentView(agent, grants),
    grants: grants.map((g) => ({
      resourceType: g.resourceType,
      resourceId: g.resourceId,
      projectName: projectNames[g.resourceId] ?? null,
      scopes: g.scopes
        .filter(isLive)
        .map((s) => ({ scope: s.scope, expiresAt: s.expiresAt === null ? null : s.expiresAt.toISOString() })),
    })),
  }
}

/** One of an agent's grants on the agent detail page: the resource it applies to (with a
 * ready-to-render label) and the agent's live scopes there. Carries the grant `id` so the UI
 * can revoke a whole grant or a single scope by addressing it directly. */
export interface AgentGrantView {
  id: string
  resourceType: string
  resourceId: string
  /** Display label for the resource — a project name, or `"<project> / <branch>"`; null if
   * the name couldn't be resolved. */
  resourceName: string | null
  scopes: ScopeGrantView[]
}

/** An agent plus the per-resource breakdown of its live access — what the agent detail /
 * management page renders. The flat `scopes` from {@link AgentView} stays the effective union. */
export interface AgentDetailView extends AgentView {
  grants: AgentGrantView[]
}

/** Build the agent detail view: the agent, plus one entry per grant that still holds at least
 * one live scope (expired-only grants read as no access, so they're dropped — matching the
 * roster's "live access" framing). `resourceNames` maps a grant's `resourceId` to its label. */
export function toAgentDetailView(
  agent: Agent,
  grants: readonly GrantWithScopes[],
  resourceNames: Readonly<Record<string, string>>,
  now: Date = new Date(),
): AgentDetailView {
  const isLive = (s: ScopeWithExpiry): boolean => s.expiresAt === null || s.expiresAt.getTime() > now.getTime()
  return {
    ...toAgentView(agent, grants),
    grants: grants
      .map((g) => ({
        id: g.id,
        resourceType: g.resourceType,
        resourceId: g.resourceId,
        resourceName: resourceNames[g.resourceId] ?? null,
        scopes: g.scopes
          .filter(isLive)
          .map((s) => ({ scope: s.scope, expiresAt: s.expiresAt === null ? null : s.expiresAt.toISOString() })),
      }))
      .filter((g) => g.scopes.length > 0),
  }
}

export interface BranchView {
  id: string
  name: string
  isDefault: boolean
  status: string
  region: string | null
  createdAt: string
}

export function toBranchView(b: Branch): BranchView {
  return {
    id: b.id,
    name: b.name,
    isDefault: b.isDefault,
    status: b.status,
    region: b.region,
    createdAt: b.createdAt.toISOString(),
  }
}

/** A single branch with its owner connection — the "Connection" panel's source. Kept off the
 * list view ({@link toBranchView}) so the owner credential isn't sprayed across every branch
 * fetch; only the per-branch detail route returns it. */
export interface BranchDetailView extends BranchView {
  connectionUri: string | null
}

export function toBranchDetail(b: Branch): BranchDetailView {
  return { ...toBranchView(b), connectionUri: b.connectionUri }
}

/** One agent query attempt, as shown in the project activity feed. */
export interface ActivityEventView {
  id: string
  agentId: string
  agentName: string
  /** The branch the query ran against (null for legacy rows). */
  branch: string | null
  sql: string
  command: string | null
  requiredScopes: string[]
  status: string
  rowCount: number | null
  errorMessage: string | null
  durationMs: number | null
  createdAt: string
}

export function toActivityEventView(event: QueryEvent, agentName: string, branchName: string | null): ActivityEventView {
  return {
    id: event.id,
    agentId: event.agentId,
    agentName,
    branch: branchName,
    sql: event.sql,
    command: event.command,
    requiredScopes: event.requiredScopes,
    status: event.status,
    rowCount: event.rowCount,
    errorMessage: event.errorMessage,
    durationMs: event.durationMs,
    createdAt: event.createdAt.toISOString(),
  }
}
