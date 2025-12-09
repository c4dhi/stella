import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'light' | 'dark' | 'system'

interface ThemeState {
  theme: Theme
  resolvedTheme: 'light' | 'dark'
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  initializeTheme: () => void
}

// Get system preference
const getSystemTheme = (): 'light' | 'dark' => {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

// Apply theme to document
const applyTheme = (resolved: 'light' | 'dark') => {
  if (typeof document === 'undefined') return
  document.body.classList.toggle('dark', resolved === 'dark')
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'system',
      resolvedTheme: getSystemTheme(),

      setTheme: (theme) => {
        const resolved = theme === 'system' ? getSystemTheme() : theme
        set({ theme, resolvedTheme: resolved })
        applyTheme(resolved)
      },

      toggleTheme: () => {
        const current = get().resolvedTheme
        const newTheme = current === 'light' ? 'dark' : 'light'
        get().setTheme(newTheme)
      },

      initializeTheme: () => {
        const { theme } = get()
        const resolved = theme === 'system' ? getSystemTheme() : theme
        set({ resolvedTheme: resolved })
        applyTheme(resolved)
      },
    }),
    {
      name: 'stella-theme',
      onRehydrateStorage: () => (state) => {
        // Apply theme on page load after rehydration
        if (state) {
          const resolved = state.theme === 'system' ? getSystemTheme() : state.theme
          state.resolvedTheme = resolved
          applyTheme(resolved)
        }
      },
    }
  )
)

// Listen for system theme changes
if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const store = useThemeStore.getState()
    if (store.theme === 'system') {
      const resolved = getSystemTheme()
      useThemeStore.setState({ resolvedTheme: resolved })
      applyTheme(resolved)
    }
  })
}
