import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api.ts'
import { unwrap } from './http.ts'
import { keys } from './keys.ts'

/** Plain fetcher (used by the root route loader to decide first-run vs dashboard). */
export function fetchMe() {
  return unwrap(api.api.me.get())
}

export function useMe() {
  return useQuery({ queryKey: keys.me(), queryFn: fetchMe })
}

/** Mark the first-run onboarding complete (idempotent server-side); refresh `me` so the
 * sidebar gate and landing redirect react immediately. */
export function useCompleteOnboarding() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => unwrap(api.api.me.onboarding.complete.post()),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.me() })
    },
  })
}

/** Plain fetcher (used by the root route loader to pick a landing org). */
export function fetchOrganizations() {
  return unwrap(api.api.organizations.get())
}

export function useOrganizations() {
  return useQuery({ queryKey: keys.orgs(), queryFn: fetchOrganizations })
}

/** Plain fetcher (used by the landing loader to decide between the dashboard and the
 * guided get-started flow for a fresh org). */
export function fetchOrgProjects(orgId: string) {
  return unwrap(api.api.organizations({ orgId }).projects.get())
}

export function useOrgProjects(orgId: string) {
  return useQuery({
    queryKey: keys.orgProjects(orgId),
    queryFn: () => fetchOrgProjects(orgId),
  })
}

export function useOrgAgents(orgId: string) {
  return useQuery({
    queryKey: keys.orgAgents(orgId),
    queryFn: () => unwrap(api.api.organizations({ orgId }).agents.get()),
  })
}

/** The org's resource usage against its caps (projects, branches, agents) — the settings
 * page's usage bars. The limits travel with the counts (server-side, from RESOURCE_LIMITS). */
export function useOrgUsage(orgId: string) {
  return useQuery({
    queryKey: keys.orgUsage(orgId),
    queryFn: () => unwrap(api.api.organizations({ orgId }).usage.get()),
  })
}

/** The org's member roster (user, role, joined-at). */
export function useOrgMembers(orgId: string) {
  return useQuery({
    queryKey: keys.orgMembers(orgId),
    queryFn: () => unwrap(api.api.organizations({ orgId }).members.get()),
  })
}

/** Remove a member (or leave, by passing your own id). Refreshes the roster. */
export function useRemoveMember(orgId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (memberId: string) => unwrap(api.api.organizations({ orgId }).members({ memberId }).delete()),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.orgMembers(orgId) })
    },
  })
}

/** Leave an organization — delete your own membership (the same endpoint as remove, addressed
 * to yourself). Refreshes the org list so the org drops out of the switcher; the caller
 * navigates away on success. The server's last-owner guard still applies. */
export function useLeaveOrganization(orgId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (selfUserId: string) =>
      unwrap(api.api.organizations({ orgId }).members({ memberId: selfUserId }).delete()),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.orgs() })
    },
  })
}

/** The org's live (pending, unexpired) invite links. */
export function useOrgInvitations(orgId: string) {
  return useQuery({
    queryKey: keys.orgInvitations(orgId),
    queryFn: () => unwrap(api.api.organizations({ orgId }).invitations.get()),
  })
}

/** Mint a fresh invite link. The response carries the one-time token (build the shareable URL
 * from it; it's never shown again). Refreshes the pending-invites list. */
export function useCreateInvitation(orgId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => unwrap(api.api.organizations({ orgId }).invitations.post({})),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.orgInvitations(orgId) })
    },
  })
}

/** Revoke (kill) an invite link, then refresh the pending-invites list. */
export function useRevokeInvitation(orgId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (invitationId: string) =>
      unwrap(api.api.organizations({ orgId }).invitations({ invitationId }).delete()),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.orgInvitations(orgId) })
    },
  })
}

/** Preview an invite link before redeeming it: the org + role it grants, whether it's still
 * valid, and whether you're already a member. No retry — a 404 means an unknown/dead token. */
export function useInvitePreview(token: string) {
  return useQuery({
    queryKey: keys.invitePreview(token),
    queryFn: () => unwrap(api.api.invitations({ token }).get()),
    retry: false,
  })
}

/** Redeem an invite link: join the signed-in user to the org. Returns `{ organizationId }` so the
 * caller can navigate there; refreshes the org list so the new org appears in the switcher. */
export function useAcceptInvite() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (token: string) => unwrap(api.api.invitations({ token }).accept.post()),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.orgs() })
    },
  })
}

export function useOrgRequests(
  orgId: string,
  status: 'pending' | 'approved' | 'denied',
  options?: { refetchInterval?: number | false },
) {
  return useQuery({
    queryKey: keys.orgRequests(orgId, status),
    queryFn: () => unwrap(api.api.organizations({ orgId }).requests.get({ query: { status } })),
    refetchInterval: options?.refetchInterval,
  })
}

/** Approve or deny a scope request, then refresh the org's requests, agents and projects. */
export function useResolveRequest(orgId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approve' | 'deny' }) =>
      decision === 'approve'
        ? unwrap(api.api['scope-requests']({ id }).approve.post())
        : unwrap(api.api['scope-requests']({ id }).deny.post()),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.orgRequests(orgId, 'pending') })
      void qc.invalidateQueries({ queryKey: keys.orgAgents(orgId) })
      void qc.invalidateQueries({ queryKey: keys.orgProjects(orgId) })
    },
  })
}

/** Create an org-scoped agent (born grant-less); the response carries the one-time API
 * key. Refreshes the org roster and project counts. */
export function useCreateAgent(orgId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ name }: { name: string }) => unwrap(api.api.organizations({ orgId }).agents.post({ name })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.orgAgents(orgId) })
      void qc.invalidateQueries({ queryKey: keys.orgProjects(orgId) })
    },
  })
}

/** One agent with the per-resource breakdown of its live access — the agent detail /
 * management page's source. */
export function useAgent(agentId: string) {
  return useQuery({
    queryKey: keys.agent(agentId),
    queryFn: () => unwrap(api.api.agents({ id: agentId }).get()),
  })
}

/** Mint a fresh one-time API key for an existing agent (the old key stops working). The
 * onboarding wizard and the agent detail page use this to (re)issue a key; the plaintext is
 * never stored server-side. Refreshes the org roster and the agent (the key prefix changes). */
export function useRotateAgentKey(orgId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (agentId: string) => unwrap(api.api.agents({ id: agentId })['rotate-key'].post()),
    onSuccess: (_data, agentId) => {
      void qc.invalidateQueries({ queryKey: keys.orgAgents(orgId) })
      void qc.invalidateQueries({ queryKey: keys.agent(agentId) })
    },
  })
}

/** Refresh everything that reflects an agent's access after a grant change. */
function invalidateAgentAccess(qc: ReturnType<typeof useQueryClient>, orgId: string, agentId: string) {
  void qc.invalidateQueries({ queryKey: keys.agent(agentId) })
  void qc.invalidateQueries({ queryKey: keys.orgAgents(orgId) })
  void qc.invalidateQueries({ queryKey: keys.orgProjects(orgId) })
}

/** Revoke a single scope from one of an agent's grants (e.g. drop db:write, keep db:read).
 * Pure metadata change server-side; the agent's next query resolves to a lesser connection. */
export function useRevokeScope(orgId: string, agentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ grantId, scope }: { grantId: string; scope: string }) =>
      unwrap(api.api.agents({ id: agentId }).grants({ grantId }).scopes({ scope }).delete()),
    onSuccess: () => invalidateAgentAccess(qc, orgId, agentId),
  })
}

/** Revoke an agent's entire grant on a resource (all scopes there at once). */
export function useRevokeGrant(orgId: string, agentId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (grantId: string) => unwrap(api.api.agents({ id: agentId }).grants({ grantId }).delete()),
    onSuccess: () => invalidateAgentAccess(qc, orgId, agentId),
  })
}

/** Delete an agent entirely, then refresh the org roster and project counts. */
export function useDeleteAgent(orgId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (agentId: string) => unwrap(api.api.agents({ id: agentId }).delete()),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.orgAgents(orgId) })
      void qc.invalidateQueries({ queryKey: keys.orgProjects(orgId) })
    },
  })
}

export function useBranches(projectId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: keys.branches(projectId),
    queryFn: () => unwrap(api.api.projects({ id: projectId }).branches.get()),
    enabled: options?.enabled,
  })
}

/** One branch with its owner connection (for the Connection panel). */
export function useBranch(projectId: string, branch: string) {
  return useQuery({
    queryKey: keys.branch(projectId, branch),
    queryFn: () => unwrap(api.api.projects({ id: projectId }).branches({ branch }).get()),
  })
}

export function useProject(projectId: string, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: keys.project(projectId),
    queryFn: () => unwrap(api.api.projects({ id: projectId }).get()),
    enabled: options?.enabled,
  })
}

/** The query audit feed for one branch of a project. */
export function useActivity(projectId: string, branch: string) {
  return useQuery({
    queryKey: keys.activity(projectId, branch),
    queryFn: () => unwrap(api.api.projects({ id: projectId }).activity.get({ query: { branch } })),
  })
}

/** Delete a project, then refresh the org's project list. */
export function useDeleteProject(orgId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (projectId: string) => unwrap(api.api.projects({ id: projectId }).delete()),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.orgProjects(orgId) })
    },
  })
}

/** Create a branch of a project (copy-on-write clone of `from`, or the default branch). Returns
 * the created branch so the caller can navigate to it; refreshes the project's branch list. */
export function useCreateBranch(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { name: string; from?: string }) =>
      unwrap(api.api.projects({ id: projectId }).branches.post(input)),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.branches(projectId) })
    },
  })
}

/** Delete a non-default branch, then refresh the project's branch list. */
export function useDeleteBranch(projectId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (branch: string) => unwrap(api.api.projects({ id: projectId }).branches({ branch }).delete()),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.branches(projectId) })
    },
  })
}

/** Create a project in the currently-viewed org and refresh that org's list. */
export function useCreateProject(orgId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => unwrap(api.api.organizations({ orgId }).projects.post({ name })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.orgProjects(orgId) })
    },
  })
}
