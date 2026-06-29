import { Dispatch, SetStateAction, useEffect, useRef, useState } from 'react'

/**
 * useState whose value is mirrored to localStorage so a UI preference survives
 * reloads. SSR-safe and resilient to unavailable storage (private mode, quota,
 * locked-down browsers): on any failure it transparently falls back to
 * in-memory state instead of throwing.
 *
 * The default is NOT written to storage on mount — only an actual change is
 * persisted. This keeps the default "live": simply visiting the page never
 * freezes the current default into storage, so a later change to the default
 * still takes effect for users who never touched the setting.
 *
 * The key is read once on mount; changing it across renders is not supported
 * (matching React's own state-init semantics).
 */
export function usePersistedState<T>(
  key: string,
  defaultValue: T
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === 'undefined') return defaultValue
    try {
      const raw = window.localStorage.getItem(key)
      return raw == null ? defaultValue : (JSON.parse(raw) as T)
    } catch {
      return defaultValue
    }
  })

  // Skip the initial run so the default is never persisted just by mounting.
  const isInitialMount = useRef(true)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false
      return
    }
    if (typeof window === 'undefined') return
    try {
      window.localStorage.setItem(key, JSON.stringify(value))
    } catch {
      // Storage unavailable (private mode / quota exceeded) — keep state in
      // memory only; the preference simply won't persist this session.
    }
  }, [key, value])

  return [value, setValue]
}
