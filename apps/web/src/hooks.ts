import type { AgentView, ProjectSummary, ScopeRequestView } from '@walnut/api/types'
import { useCallback, useEffect, useState } from 'react'
import { api } from './api.ts'
import { readErrorBody } from './lib/errors.ts'

export interface AsyncList<T> {
  data: T[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

export function useProjects(): AsyncList<ProjectSummary> {
  const [data, setData] = useState<ProjectSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    const res = await api.api.projects.get()
    if (res.data !== null) {
      setData(res.data)
      setError(null)
    } else {
      setError(readErrorBody(res.error?.value).message)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { data, loading, error, refresh }
}

export function useAgents(projectId: string | null): AsyncList<AgentView> {
  const [data, setData] = useState<AgentView[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (projectId === null) {
      setData([])
      return
    }
    setLoading(true)
    const res = await api.api.projects({ id: projectId }).agents.get()
    if (res.data !== null) {
      setData(res.data)
      setError(null)
    } else {
      setError(readErrorBody(res.error?.value).message)
    }
    setLoading(false)
  }, [projectId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { data, loading, error, refresh }
}

export function useScopeRequests(): AsyncList<ScopeRequestView> {
  const [data, setData] = useState<ScopeRequestView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    const res = await api.api['scope-requests'].get({ query: {} })
    if (res.data !== null) {
      setData(res.data)
      setError(null)
    } else {
      setError(readErrorBody(res.error?.value).message)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { data, loading, error, refresh }
}
