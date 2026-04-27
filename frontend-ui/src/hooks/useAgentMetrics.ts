import { useState, useEffect, useCallback } from 'react'
import { apiClient } from '../services/ApiClient'
import type { AgentMetricsResponse, MetricsTimelinePoint } from '../lib/api-types'

export function useAgentMetrics(
  projectId: string | null,
  agentSlug: string | null,
  days: number = 30,
) {
  const [data, setData] = useState<AgentMetricsResponse | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    if (!projectId || !agentSlug) {
      setData(null)
      return
    }
    try {
      setIsLoading(true)
      setError(null)
      const to = new Date().toISOString()
      const from = new Date(Date.now() - days * 86400000).toISOString()
      const result = await apiClient.getAgentMetrics(projectId, agentSlug, from, to)
      setData(result)
    } catch (err) {
      setError('Failed to load agent metrics')
      setData(null)
    } finally {
      setIsLoading(false)
    }
  }, [projectId, agentSlug, days])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return { data, isLoading, error, refetch: fetchData }
}

export function useMetricsTimeline(
  projectId: string | null,
  agentSlug: string | null,
  stage?: { stage: string } | string | null,
  days: number = 30,
) {
  const [points, setPoints] = useState<MetricsTimelinePoint[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const stageKey = typeof stage === 'string' ? stage : stage?.stage

  const fetchData = useCallback(async () => {
    if (!projectId || !agentSlug) {
      setPoints([])
      return
    }
    try {
      setIsLoading(true)
      setError(null)
      const since = new Date(Date.now() - days * 86400000).toISOString()
      const result = await apiClient.getMetricsTimeline(projectId, agentSlug, since, stageKey)
      setPoints(result.points)
    } catch {
      setError('Failed to load metrics timeline')
      setPoints([])
    } finally {
      setIsLoading(false)
    }
  }, [projectId, agentSlug, stageKey, days])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return { points, isLoading, error, refetch: fetchData }
}
