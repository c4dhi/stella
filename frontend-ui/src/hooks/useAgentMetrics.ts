import { useState, useEffect, useCallback, useRef } from 'react'
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

const POLL_INTERVAL_MS = 10_000
const MAX_POINTS = 200

/**
 * Hook for live TTFAB timeline data. Polls every 10 seconds,
 * only updates when new data points arrive.
 */
export function useMetricsTimeline(
  projectId: string | null,
  agentSlug: string | null,
  stage: string = 'ttfab',
) {
  const [points, setPoints] = useState<MetricsTimelinePoint[]>([])
  const lastTimestampRef = useRef<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const poll = useCallback(async () => {
    if (!projectId || !agentSlug) return

    try {
      // Query from last known timestamp (or 1 hour ago on first poll)
      const since = lastTimestampRef.current || new Date(Date.now() - 3600000).toISOString()
      const result = await apiClient.getMetricsTimeline(projectId, agentSlug, since, stage)

      if (result.points.length > 0) {
        // Update last timestamp to most recent point
        lastTimestampRef.current = result.points[result.points.length - 1].timestamp

        setPoints((prev) => {
          // Deduplicate by timestamp + sessionId to avoid dropping real points from different sessions
          const existingKeys = new Set(prev.map((p) => `${p.timestamp}|${p.sessionId}`))
          const newPoints = result.points.filter((p) => !existingKeys.has(`${p.timestamp}|${p.sessionId}`))
          if (newPoints.length === 0) return prev

          // Append and cap at MAX_POINTS
          const combined = [...prev, ...newPoints]
          return combined.length > MAX_POINTS ? combined.slice(-MAX_POINTS) : combined
        })
      }
    } catch {
      // Silent fail on poll — don't disrupt the UI
    }
  }, [projectId, agentSlug, stage])

  useEffect(() => {
    // Reset on parameter change
    setPoints([])
    lastTimestampRef.current = null

    // Initial fetch
    poll()

    // Start polling
    intervalRef.current = setInterval(poll, POLL_INTERVAL_MS)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [poll])

  return { points }
}
