import { parseScopes } from '@walnut/core'
import type { Agent, AgentGrant, Branch, Organization, Project, ScopeRequest } from '@walnut/db'

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
  projectId: string
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
  projectId: string
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
    projectId: agent.projectId,
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
    projectId: r.projectId,
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

/** An agent in the org-wide roster: its view plus the name of its home project. */
export interface OrgAgentView extends AgentView {
  projectName: string
}

export function toOrgAgentView(agent: Agent, grants: readonly AgentGrant[], projectName: string): OrgAgentView {
  return { ...toAgentView(agent, grants), projectName }
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
