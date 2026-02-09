import { useState, useEffect, useCallback, useRef } from 'react'
import { apiClient } from '../services/ApiClient'
import { getSharedSSEManager } from '../services/SharedSSEManager'
import { usePageVisibility } from './usePageVisibility'
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
 * - Cross-tab SSE sharing via BroadcastChannel (reduces HTTP connections)
 * - Pauses when tab is hidden
 *
 * @param projectId - The project ID to fetch metrics for
 * @returns Metrics data, loading/connection states, and refresh function
 */
export function useProjectMetrics(projectId: string | undefined): UseProjectMetricsResult {
  const [metrics, setMetrics] = useState<ProjectMetrics | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<Error | null>(null)
  const isVisible = usePageVisibility()
  const callbackRef = useRef<((data: any) => void) | null>(null)

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

    // Skip SSE when tab is hidden to reduce connection usage
    if (!isVisible) {
      console.debug('[useProjectMetrics] Tab hidden, pausing SSE subscription')
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

    // Subscribe to real-time updates via shared SSE manager
    const manager = getSharedSSEManager('project-metrics', projectId)

    const callback = (data: any) => {
      setMetrics(data as ProjectMetrics)
      setError(null)
    }
    callbackRef.current = callback

    manager.subscribe(
      callback,
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
      if (callbackRef.current) {
        manager.unsubscribe(callbackRef.current)
        callbackRef.current = null
      }
      setIsConnected(false)
    }
  }, [projectId, isVisible])

  return {
    metrics,
    isLoading,
    isConnected,
    error,
    refresh,
  }
}
