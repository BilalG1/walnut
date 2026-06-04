/** Central React Query key factory — one place so invalidation stays consistent. */
export const keys = {
  me: () => ['me'] as const,
  orgs: () => ['orgs'] as const,
  orgProjects: (orgId: string) => ['orgs', orgId, 'projects'] as const,
  orgAgents: (orgId: string) => ['orgs', orgId, 'agents'] as const,
  orgUsage: (orgId: string) => ['orgs', orgId, 'usage'] as const,
  orgMembers: (orgId: string) => ['orgs', orgId, 'members'] as const,
  orgInvitations: (orgId: string) => ['orgs', orgId, 'invitations'] as const,
  orgRequests: (orgId: string, status: string) => ['orgs', orgId, 'requests', status] as const,
  invitePreview: (token: string) => ['invitations', token] as const,
  agent: (agentId: string) => ['agents', agentId] as const,
  project: (projectId: string) => ['projects', projectId] as const,
  branches: (projectId: string) => ['projects', projectId, 'branches'] as const,
  branch: (projectId: string, branch: string) => ['projects', projectId, 'branches', branch] as const,
  activity: (projectId: string, branch?: string) =>
    branch === undefined
      ? (['projects', projectId, 'activity'] as const)
      : (['projects', projectId, 'activity', branch] as const),
}
