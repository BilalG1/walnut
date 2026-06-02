import { parseScopes } from '@walnut/core'
import type { Agent, AgentGrant, Branch, Organization, Project, QueryEvent, ScopeRequest } from '@walnut/db'

export interface ProjectSummary {
  id: string
  name: string
  provider: string
  region: string | null
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
  status: string
  createdAt: string
  resolvedAt: string | null
}

export function toProjectSummary(p: Project): ProjectSummary {
  return {
    id: p.id,
    name: p.name,
    provider: p.provider,
    region: p.region,
    status: p.status,
    error: p.error,
    createdAt: p.createdAt.toISOString(),
  }
}

export function toProjectDetail(p: Project): ProjectDetail {
  return { ...toProjectSummary(p), connectionUri: p.connectionUri }
}

/** An agent's effective scopes: the deduplicated union across all its grants. */
export function effectiveScopes(grants: readonly AgentGrant[]): string[] {
  return parseScopes(grants.flatMap((g) => g.scopes))
}

export function toAgentView(agent: Agent, grants: readonly AgentGrant[]): AgentView {
  return {
    id: agent.id,
    organizationId: agent.organizationId,
    name: agent.name,
    keyPrefix: agent.keyPrefix,
    scopes: effectiveScopes(grants),
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

/** One of an agent's grants, as shown in the org roster: the resource it applies to (with
 * a resolved project name when known) and the scopes held there. */
export interface OrgAgentGrantView {
  resourceType: string
  resourceId: string
  projectName: string | null
  scopes: string[]
}

/** An agent in the org-wide roster: its view plus a per-resource breakdown of its access
 * (an org-scoped agent may reach several projects, each with its own scopes). */
export interface OrgAgentView extends AgentView {
  grants: OrgAgentGrantView[]
}

export function toOrgAgentView(
  agent: Agent,
  grants: readonly AgentGrant[],
  projectNames: Readonly<Record<string, string>>,
): OrgAgentView {
  return {
    ...toAgentView(agent, grants),
    grants: grants.map((g) => ({
      resourceType: g.resourceType,
      resourceId: g.resourceId,
      projectName: projectNames[g.resourceId] ?? null,
      scopes: g.scopes,
    })),
  }
}

export interface BranchView {
  id: string
  name: string
  isDefault: boolean
  createdAt: string
}

export function toBranchView(b: Branch): BranchView {
  return { id: b.id, name: b.name, isDefault: b.isDefault, createdAt: b.createdAt.toISOString() }
}

/** One agent query attempt, as shown in the project activity feed. */
export interface ActivityEventView {
  id: string
  agentId: string
  agentName: string
  sql: string
  command: string | null
  requiredScopes: string[]
  status: string
  rowCount: number | null
  errorMessage: string | null
  durationMs: number | null
  createdAt: string
}

export function toActivityEventView(event: QueryEvent, agentName: string): ActivityEventView {
  return {
    id: event.id,
    agentId: event.agentId,
    agentName,
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
