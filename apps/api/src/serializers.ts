import type { Agent, Project, ScopeRequest } from '@walnut/db'

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

export function toAgentView(a: Agent): AgentView {
  return {
    id: a.id,
    projectId: a.projectId,
    name: a.name,
    keyPrefix: a.keyPrefix,
    scopes: a.scopes,
    createdAt: a.createdAt.toISOString(),
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
