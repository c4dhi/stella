import { useState, useCallback } from 'react'
import { apiClient } from '../services/ApiClient'
import type { SessionAnalyticsResponse } from '../lib/api-types'

export function useSessionAnalytics() {
  const [data, setData] = useState<SessionAnalyticsResponse | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async (sessionId: string) => {
    try {
      setIsLoading(true)
      setError(null)
      const result = await apiClient.getSessionAnalytics(sessionId)
      setData(result)
    } catch (err) {
      setError('Failed to load session analytics')
      setData(null)
    } finally {
      setIsLoading(false)
    }
  }, [])

  return { data, isLoading, error, fetch }
}
