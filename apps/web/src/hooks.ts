import type { AgentView, ProjectSummary, ScopeRequestView } from '@walnut/api/types'
import { useCallback, useEffect, useRef, useState } from 'react'
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
  const ticket = useRef(0)

  const refresh = useCallback(async () => {
    const id = ticket.current + 1
    ticket.current = id
    setLoading(true)
    const res = await api.api.projects.get()
    if (id !== ticket.current) {
      return
    }
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
  const [loading, setLoading] = useState(projectId !== null)
  const [error, setError] = useState<string | null>(null)
  const ticket = useRef(0)

  const refresh = useCallback(async () => {
    const id = ticket.current + 1
    ticket.current = id
    if (projectId === null) {
      setData([])
      setLoading(false)
      return
    }
    setLoading(true)
    const res = await api.api.projects({ id: projectId }).agents.get()
    // Ignore responses superseded by a newer request (e.g. fast project switch).
    if (id !== ticket.current) {
      return
    }
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
  const ticket = useRef(0)

  const refresh = useCallback(async () => {
    const id = ticket.current + 1
    ticket.current = id
    setLoading(true)
    const res = await api.api['scope-requests'].get({ query: {} })
    if (id !== ticket.current) {
      return
    }
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
