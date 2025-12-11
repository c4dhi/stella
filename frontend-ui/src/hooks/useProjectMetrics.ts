import { useState, useEffect, useCallback } from 'react'
import { apiClient } from '../services/ApiClient'
import type { ProjectMetrics } from '../lib/api-types'

interface UseProjectMetricsResult {
  metrics: ProjectMetrics | null
  isLoading: boolean
  isConnected: boolean
  error: Error | null
  refresh: () => Promise<void>
}

/**
 * Hook for fetching and subscribing to real-time project metrics.
 *
 * Features:
 * - Initial fetch on mount
 * - Real-time SSE updates every 5 seconds
 * - Connection status tracking
 * - Manual refresh capability
 *
 * @param projectId - The project ID to fetch metrics for
 * @returns Metrics data, loading/connection states, and refresh function
 */
export function useProjectMetrics(projectId: string | undefined): UseProjectMetricsResult {
  const [metrics, setMetrics] = useState<ProjectMetrics | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  // Manual refresh function
  const refresh = useCallback(async () => {
    if (!projectId) return

    try {
      const data = await apiClient.getProjectMetrics(projectId)
      setMetrics(data)
      setError(null)
    } catch (err) {
      console.error('[useProjectMetrics] Failed to refresh:', err)
      setError(err instanceof Error ? err : new Error('Failed to fetch metrics'))
    }
  }, [projectId])

  useEffect(() => {
    if (!projectId) {
      setMetrics(null)
      setIsLoading(false)
      setIsConnected(false)
      return
    }

    setIsLoading(true)
    setError(null)

    // Initial fetch
    apiClient.getProjectMetrics(projectId)
      .then((data) => {
        setMetrics(data)
        setIsLoading(false)
      })
      .catch((err) => {
        console.error('[useProjectMetrics] Initial fetch failed:', err)
        setError(err instanceof Error ? err : new Error('Failed to fetch metrics'))
        setIsLoading(false)
      })

    // Subscribe to real-time updates via SSE
    const unsubscribe = apiClient.subscribeToProjectMetrics(
      projectId,
      (data) => {
        setMetrics(data)
        setError(null)
      },
      () => {
        // On error - SSE will auto-reconnect
        setIsConnected(false)
      },
      () => {
        // On open
        setIsConnected(true)
      }
    )

    return () => {
      unsubscribe()
      setIsConnected(false)
    }
  }, [projectId])

  return {
    metrics,
    isLoading,
    isConnected,
    error,
    refresh,
  }
}
