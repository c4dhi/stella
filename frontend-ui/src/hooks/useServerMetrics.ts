import { useState, useEffect, useRef } from 'react'
import { apiClient } from '../services/ApiClient'
import { usePageVisibility } from './usePageVisibility'
import type { ServerMetrics } from '../lib/api-types'

const MAX_HISTORY_POINTS = 60 // ~2 minutes of data at 2s intervals

/**
 * Hook for subscribing to real-time server metrics via SSE
 * Maintains a rolling history of metrics for charts
 * Pauses SSE connection when tab is hidden to reduce connection usage
 */
export function useServerMetricsStream() {
  const [currentMetrics, setCurrentMetrics] = useState<ServerMetrics | null>(null)
  const [metricsHistory, setMetricsHistory] = useState<ServerMetrics[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isVisible = usePageVisibility()

  // Use ref to avoid closure issues in the callback
  const historyRef = useRef<ServerMetrics[]>([])

  useEffect(() => {
    // Skip SSE when tab is hidden
    if (!isVisible) {
      console.debug('[useServerMetricsStream] Tab hidden, pausing SSE subscription')
      setIsConnected(false)
      return
    }

    const cleanup = apiClient.subscribeToServerMetrics(
      (data) => {
        setCurrentMetrics(data)
        setError(null)

        // Update history with rolling window
        const newHistory = [...historyRef.current, data].slice(-MAX_HISTORY_POINTS)
        historyRef.current = newHistory
        setMetricsHistory(newHistory)
      },
      (err) => {
        console.error('Server metrics SSE error:', err)
        setError('Connection lost. Reconnecting...')
        setIsConnected(false)
      },
      () => {
        setIsConnected(true)
        setError(null)
      }
    )

    return cleanup
  }, [isVisible])

  return { currentMetrics, metricsHistory, isConnected, error }
}

/**
 * Helper to parse BigInt string values from server metrics
 */
export function parseMemoryValue(value: string | null): number {
  if (!value) return 0
  return Number(BigInt(value))
}

/**
 * Format bytes to human-readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'

  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const k = 1024
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${units[i]}`
}

/**
 * Get color class based on usage percentage
 */
export function getUsageColor(percentage: number, isDark: boolean): string {
  if (percentage >= 90) {
    return isDark ? 'text-red-400' : 'text-red-500'
  }
  if (percentage >= 70) {
    return isDark ? 'text-yellow-400' : 'text-yellow-500'
  }
  return isDark ? 'text-green-400' : 'text-green-500'
}
