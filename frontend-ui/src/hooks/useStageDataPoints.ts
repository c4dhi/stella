import { useState, useEffect, useCallback } from 'react'
import { apiClient } from '../services/ApiClient'
import type { StageDataPoint } from '../lib/api-types'

export function useStageDataPoints(
  projectId: string | null,
  agentSlug: string | null,
  stageName: string | null,
  from: string,
  to: string,
) {
  const [points, setPoints] = useState<StageDataPoint[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const fetchPoints = useCallback(async () => {
    if (!projectId || !agentSlug || !stageName) {
      setPoints([])
      return
    }
    try {
      setIsLoading(true)
      const result = await apiClient.getStageDataPoints(projectId, agentSlug, stageName, from, to)
      setPoints(result.points)
    } catch {
      setPoints([])
    } finally {
      setIsLoading(false)
    }
  }, [projectId, agentSlug, stageName, from, to])

  useEffect(() => {
    fetchPoints()
  }, [fetchPoints])

  return { points, isLoading }
}
