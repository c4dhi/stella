// Authentication store using Zustand
import { create } from 'zustand'
import { authService, type User, type AuthTokens } from '../services/AuthService'

interface AuthState {
  user: User | null
  tokens: AuthTokens | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
  signupSuccess: string | null
}

interface AuthActions {
  login: (email: string, password: string) => Promise<void>
  signup: (email: string, password: string, name: string) => Promise<void>
  logout: () => void
  checkAuth: () => void
  clearError: () => void
}

export const useAuthStore = create<AuthState & AuthActions>((set) => ({
  // Initial state - start with loading true to check stored auth
  user: null,
  tokens: null,
  isAuthenticated: false,
  isLoading: true, // Start as true to prevent premature redirects
  error: null,
  signupSuccess: null,

  // Actions
  login: async (email, password) => {
    set({ isLoading: true, error: null })
    try {
      const { user, tokens } = await authService.login({ email, password })
      set({
        user,
        tokens,
        isAuthenticated: true,
        isLoading: false,
        error: null,
      })
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Login failed',
        isLoading: false,
      })
      throw error
    }
  },

  signup: async (email, password, name) => {
    set({ isLoading: true, error: null, signupSuccess: null })
    try {
      const { user, message, verified } = await authService.signup({ email, password, name })

      // User created but NOT authenticated (needs verification)
      set({
        user: null,
        tokens: null,
        isAuthenticated: false,
        isLoading: false,
        error: null,
        signupSuccess: message,
      })
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Signup failed',
        isLoading: false,
        signupSuccess: null,
      })
      throw error
    }
  },

  logout: () => {
    authService.logout()
    set({
      user: null,
      tokens: null,
      isAuthenticated: false,
      error: null,
    })
  },

  checkAuth: async () => {
    console.log('[Auth] Checking authentication...')
    const user = authService.getStoredUser()
    const tokens = authService.getStoredTokens()

    console.log('[Auth] Stored user:', user ? user.email : 'none')
    console.log('[Auth] Stored token:', tokens ? 'exists' : 'none')

    if (user && tokens) {
      // First, optimistically set user from localStorage
      console.log('[Auth] Restoring session from localStorage')
      set({
        user,
        tokens,
        isAuthenticated: true,
        isLoading: false,
      })

      // Then verify token is still valid by calling /auth/me
      try {
        console.log('[Auth] Verifying token with backend...')
        const currentUser = await authService.getMe()
        console.log('[Auth] Token valid, user verified:', currentUser.email)
        set({
          user: currentUser,
          tokens,
          isAuthenticated: true,
          isLoading: false,
        })
      } catch (error) {
        // Token is invalid or expired
        console.error('[Auth] Token validation failed:', error)
        authService.logout()
        set({
          user: null,
          tokens: null,
          isAuthenticated: false,
          isLoading: false,
        })
      }
    } else {
      console.log('[Auth] No stored credentials found')
      set({
        user: null,
        tokens: null,
        isAuthenticated: false,
        isLoading: false,
      })
    }
  },

  clearError: () => set({ error: null, signupSuccess: null }),
}))
