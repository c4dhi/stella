import { useState, useEffect } from 'react'

/**
 * Hook to track page visibility state.
 * Returns true when the page is visible, false when hidden (e.g., tab in background).
 *
 * Use this to pause expensive operations (SSE connections, polling) when the tab is hidden,
 * reducing connection usage and improving overall performance.
 */
export function usePageVisibility(): boolean {
  const [isVisible, setIsVisible] = useState(!document.hidden)

  useEffect(() => {
    const handler = () => setIsVisible(!document.hidden)
    document.addEventListener('visibilitychange', handler)
    return () => document.removeEventListener('visibilitychange', handler)
  }, [])

  return isVisible
}
