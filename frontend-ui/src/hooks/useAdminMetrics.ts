import { useState, useEffect, useCallback } from 'react'
import { apiClient } from '../services/ApiClient'
import type { AdminDashboardMetrics, SessionActivityDay, HistoricalUsageData, SessionStatusItem } from '../lib/api-types'

/**
 * Hook for subscribing to real-time admin dashboard metrics via SSE
 */
export function useAdminDashboardStream() {
  const [metrics, setMetrics] = useState<AdminDashboardMetrics | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const cleanup = apiClient.subscribeToAdminDashboard(
      (data) => {
        setMetrics(data)
        setError(null)
      },
      (err) => {
        console.error('Admin dashboard SSE error:', err)
        setError('Connection lost. Reconnecting...')
        setIsConnected(false)
      },
      () => {
        setIsConnected(true)
        setError(null)
      }
    )

    return cleanup
  }, [])

  return { metrics, isConnected, error }
}

/**
 * Hook for fetching session activity data for the 90-day grid
 */
export function useSessionActivity() {
  const [data, setData] = useState<SessionActivityDay[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true)
      const activityData = await apiClient.getSessionActivity()
      setData(activityData)
      setError(null)
    } catch (err) {
      console.error('Failed to fetch session activity:', err)
      setError('Failed to load activity data')
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return { data, isLoading, error, refetch: fetchData }
}

/**
 * Hook for fetching historical usage data for charts
 */
export function useUsageHistory(days: number = 30) {
  const [data, setData] = useState<HistoricalUsageData[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    try {
      setIsLoading(true)
      const historyData = await apiClient.getUsageHistory(days)
      setData(historyData)
      setError(null)
    } catch (err) {
      console.error('Failed to fetch usage history:', err)
      setError('Failed to load history data')
    } finally {
      setIsLoading(false)
    }
  }, [days])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  return { data, isLoading, error, refetch: fetchData }
}

/**
 * Hook for fetching all sessions with their status
 */
export function useAllSessions() {
  const [sessions, setSessions] = useState<SessionStatusItem[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async (isInitialLoad = false) => {
    try {
      // Only show loading state on initial load, not on refreshes
      if (isInitialLoad) {
        setIsLoading(true)
      }
      const sessionsData = await apiClient.getAllSessions()
      setSessions(sessionsData)
      setError(null)
    } catch (err) {
      console.error('Failed to fetch sessions:', err)
      setError('Failed to load sessions')
    } finally {
      if (isInitialLoad) {
        setIsLoading(false)
      }
    }
  }, [])

  useEffect(() => {
    fetchData(true) // Initial load shows loading state
    // Refresh every 5 seconds for real-time updates (silent refresh)
    const interval = setInterval(() => fetchData(false), 5000)
    return () => clearInterval(interval)
  }, [fetchData])

  return { sessions, isLoading, error, refetch: () => fetchData(true) }
}
