/** Central React Query key factory — one place so invalidation stays consistent. */
export const keys = {
  orgs: () => ['orgs'] as const,
  orgProjects: (orgId: string) => ['orgs', orgId, 'projects'] as const,
  orgAgents: (orgId: string) => ['orgs', orgId, 'agents'] as const,
  orgRequests: (orgId: string, status: string) => ['orgs', orgId, 'requests', status] as const,
  project: (projectId: string) => ['projects', projectId] as const,
  branches: (projectId: string) => ['projects', projectId, 'branches'] as const,
  activity: (projectId: string) => ['projects', projectId, 'activity'] as const,
}
