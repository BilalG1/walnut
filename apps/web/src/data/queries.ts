import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../api.ts'
import { unwrap } from './http.ts'
import { keys } from './keys.ts'

/** Plain fetcher (used by the root route loader to pick a landing org). */
export function fetchOrganizations() {
  return unwrap(api.api.organizations.get())
}

export function useOrganizations() {
  return useQuery({ queryKey: keys.orgs(), queryFn: fetchOrganizations })
}

export function useOrgProjects(orgId: string) {
  return useQuery({
    queryKey: keys.orgProjects(orgId),
    queryFn: () => unwrap(api.api.organizations({ orgId }).projects.get()),
  })
}

export function useOrgAgents(orgId: string) {
  return useQuery({
    queryKey: keys.orgAgents(orgId),
    queryFn: () => unwrap(api.api.organizations({ orgId }).agents.get()),
  })
}

export function useOrgRequests(orgId: string, status: 'pending' | 'approved' | 'denied') {
  return useQuery({
    queryKey: keys.orgRequests(orgId, status),
    queryFn: () => unwrap(api.api.organizations({ orgId }).requests.get({ query: { status } })),
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

/** Create an agent in a project; the response carries the one-time API key. Refreshes
 * the org roster and project counts. */
export function useCreateAgent(orgId: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ projectId, name }: { projectId: string; name: string }) =>
      unwrap(api.api.projects({ id: projectId }).agents.post({ name })),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.orgAgents(orgId) })
      void qc.invalidateQueries({ queryKey: keys.orgProjects(orgId) })
    },
  })
}

export function useBranches(projectId: string) {
  return useQuery({
    queryKey: keys.branches(projectId),
    queryFn: () => unwrap(api.api.projects({ id: projectId }).branches.get()),
  })
}

export function useProject(projectId: string) {
  return useQuery({
    queryKey: keys.project(projectId),
    queryFn: () => unwrap(api.api.projects({ id: projectId }).get()),
  })
}

export function useActivity(projectId: string) {
  return useQuery({
    queryKey: keys.activity(projectId),
    queryFn: () => unwrap(api.api.projects({ id: projectId }).activity.get()),
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
