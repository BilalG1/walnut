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
