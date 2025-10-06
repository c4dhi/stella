// Real Authentication Service
// Integrates with Session Management Server auth endpoints

export interface User {
  id: string
  email: string
  name: string
  verified?: boolean
  createdAt: string
}

export interface AuthTokens {
  accessToken: string
  refreshToken?: string
}

export interface LoginCredentials {
  email: string
  password: string
}

export interface SignupCredentials extends LoginCredentials {
  name: string
}

const AUTH_STORAGE_KEY = 'grace_auth_token'
const USER_STORAGE_KEY = 'grace_user'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'

class AuthService {
  // ============================================================================
  // Real Authentication with Backend
  // ============================================================================

  async login(credentials: LoginCredentials): Promise<{ user: User; tokens: AuthTokens }> {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
      })

      if (!response.ok) {
        let errorMessage = 'Login failed'
        try {
          const errorData = await response.json()
          // NestJS returns errors in different formats:
          // 1. { message: string }
          // 2. { message: string[] }
          // 3. { message: { message: string } } - nested structure from UnauthorizedException
          if (typeof errorData.message === 'string') {
            errorMessage = errorData.message
          } else if (Array.isArray(errorData.message)) {
            errorMessage = errorData.message.join(', ')
          } else if (typeof errorData.message === 'object' && errorData.message.message) {
            // Handle nested message structure
            errorMessage = errorData.message.message
          } else if (errorData.error) {
            errorMessage = errorData.error
          }
        } catch {
          errorMessage = `Login failed (${response.status})`
        }
        throw new Error(errorMessage)
      }

      const data = await response.json()

      // Backend returns { user, token } format
      const user: User = data.user
      const tokens: AuthTokens = {
        accessToken: data.token,
      }

      // Store in localStorage
      this.storeAuth(user, tokens)

      return { user, tokens }
    } catch (error) {
      // If it's already an Error, re-throw it
      if (error instanceof Error) {
        throw error
      }
      // Network errors or other issues
      throw new Error('Unable to connect to server. Please try again.')
    }
  }

  async signup(credentials: SignupCredentials): Promise<{ user: User; message: string; verified: boolean }> {
    try {
      const response = await fetch(`${API_BASE_URL}/auth/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials),
      })

      if (!response.ok) {
        let errorMessage = 'Signup failed'
        try {
          const errorData = await response.json()
          // NestJS returns errors in different formats:
          // 1. { message: string }
          // 2. { message: string[] }
          // 3. { message: { message: string } } - nested structure from exceptions
          if (typeof errorData.message === 'string') {
            errorMessage = errorData.message
          } else if (Array.isArray(errorData.message)) {
            errorMessage = errorData.message.join(', ')
          } else if (typeof errorData.message === 'object' && errorData.message.message) {
            // Handle nested message structure
            errorMessage = errorData.message.message
          } else if (errorData.error) {
            errorMessage = errorData.error
          }

          // Handle specific error cases
          if (errorMessage.includes('already exists') || errorMessage.includes('duplicate')) {
            errorMessage = 'Email already registered'
          }
        } catch {
          errorMessage = `Signup failed (${response.status})`
        }
        throw new Error(errorMessage)
      }

      const data = await response.json()

      // Backend returns { user, message, verified } - NO token for unverified users
      const user: User = data.user
      const message: string = data.message || 'Signup successful. Please contact your administrator for account approval.'
      const verified: boolean = data.verified || false

      // Do NOT store auth - user needs verification first
      return { user, message, verified }
    } catch (error) {
      // If it's already an Error, re-throw it
      if (error instanceof Error) {
        throw error
      }
      // Network errors or other issues
      throw new Error('Unable to connect to server. Please try again.')
    }
  }

  async getMe(): Promise<User> {
    const token = this.getStoredToken()

    if (!token) {
      throw new Error('No authentication token found')
    }

    const response = await fetch(`${API_BASE_URL}/auth/me`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      // Token might be expired or invalid
      this.logout()
      throw new Error('Session expired. Please login again.')
    }

    const user = await response.json()

    // Update stored user data
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user))

    return user
  }

  logout(): void {
    localStorage.removeItem(AUTH_STORAGE_KEY)
    localStorage.removeItem(USER_STORAGE_KEY)
  }

  getStoredUser(): User | null {
    try {
      const userData = localStorage.getItem(USER_STORAGE_KEY)
      if (!userData) return null
      return JSON.parse(userData)
    } catch {
      return null
    }
  }

  getStoredToken(): string | null {
    try {
      const token = localStorage.getItem(AUTH_STORAGE_KEY)
      return token
    } catch {
      return null
    }
  }

  getStoredTokens(): AuthTokens | null {
    const token = this.getStoredToken()
    if (!token) return null

    return {
      accessToken: token,
    }
  }

  isAuthenticated(): boolean {
    return !!this.getStoredToken()
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private storeAuth(user: User, tokens: AuthTokens): void {
    localStorage.setItem(USER_STORAGE_KEY, JSON.stringify(user))
    localStorage.setItem(AUTH_STORAGE_KEY, tokens.accessToken)
  }
}

// Export singleton instance
export const authService = new AuthService()

// Export class for testing
export { AuthService }
