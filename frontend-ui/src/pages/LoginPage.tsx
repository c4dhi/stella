import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuthStore } from '../store/authStore'
import { useThemeStore } from '../store/themeStore'
import ThemeToggle from '../components/ThemeToggle'

export default function LoginPage() {
  const navigate = useNavigate()
  const { login, signup, isLoading, isAuthenticated, error, signupSuccess, clearError } = useAuthStore()
  const { resolvedTheme, initializeTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'

  useEffect(() => {
    initializeTheme()
  }, [initializeTheme])

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/dashboard', { replace: true })
    }
  }, [isAuthenticated, navigate])

  const [isSignup, setIsSignup] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [formData, setFormData] = useState({
    email: '',
    password: '',
    name: '',
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    clearError()

    try {
      if (isSignup) {
        await signup(formData.email, formData.password, formData.name)
        setFormData({ email: '', password: '', name: '' })
        setIsSignup(false)
      } else {
        await login(formData.email, formData.password)
        navigate('/dashboard')
      }
    } catch (error) {
      console.error('Authentication error:', error)
    }
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({
      ...prev,
      [e.target.name]: e.target.value,
    }))
  }

  const toggleMode = () => {
    setIsSignup(!isSignup)
    clearError()
    setFormData({ email: '', password: '', name: '' })
  }

  return (
    <div className={`min-h-screen flex flex-col transition-colors duration-200 ${
      isDark ? 'bg-surface-dark' : 'bg-surface'
    }`}>
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4">
        <span className={`text-heading-sm font-semibold tracking-tight ${
          isDark ? 'text-content-inverse' : 'text-content'
        }`}>
          STELLA
        </span>
        <ThemeToggle />
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center px-4 py-8">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
          className="w-full max-w-sm"
        >
          {/* Title */}
          <div className="text-center mb-8">
            <h1 className={`text-display-sm mb-2 ${
              isDark ? 'text-content-inverse' : 'text-content'
            }`}>
              {isSignup ? 'Create account' : 'Welcome back'}
            </h1>
            <p className={`text-body ${
              isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'
            }`}>
              {isSignup
                ? 'Get started with your free account'
                : 'Sign in to continue to your dashboard'}
            </p>
          </div>

          {/* Card */}
          <div className={`rounded-2xl p-6 ${
            isDark
              ? 'bg-surface-dark-secondary border border-border-dark'
              : 'bg-white border border-border shadow-lg'
          }`}>
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Name field (signup only) */}
              {isSignup && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <label className={`block text-label uppercase mb-1.5 ${
                    isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'
                  }`}>
                    Name
                  </label>
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleInputChange}
                    required={isSignup}
                    className="input-field"
                    placeholder="Your name"
                  />
                </motion.div>
              )}

              {/* Email field */}
              <div>
                <label className={`block text-label uppercase mb-1.5 ${
                  isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'
                }`}>
                  Email
                </label>
                <input
                  type="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  required
                  className="input-field"
                  placeholder="you@example.com"
                />
              </div>

              {/* Password field */}
              <div>
                <label className={`block text-label uppercase mb-1.5 ${
                  isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'
                }`}>
                  Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    value={formData.password}
                    onChange={handleInputChange}
                    required
                    className="input-field pr-10"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className={`absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded transition-colors ${
                      isDark
                        ? 'text-content-inverse-tertiary hover:text-content-inverse-secondary'
                        : 'text-content-tertiary hover:text-content-secondary'
                    }`}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
              </div>

              {/* Success message */}
              {signupSuccess && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`p-3 rounded-lg text-body-sm ${
                    isDark
                      ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400'
                      : 'bg-emerald-50 border border-emerald-200 text-emerald-700'
                  }`}
                >
                  <p className="font-medium mb-0.5">Account created</p>
                  <p className="opacity-80">{signupSuccess}</p>
                </motion.div>
              )}

              {/* Error message */}
              {error && (
                <motion.div
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`p-3 rounded-lg text-body-sm ${
                    isDark
                      ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                      : 'bg-red-50 border border-red-200 text-red-700'
                  }`}
                >
                  {error}
                </motion.div>
              )}

              {/* Submit button */}
              <button
                type="submit"
                disabled={isLoading}
                className="btn-primary w-full mt-2"
              >
                {isLoading ? (
                  <span className="flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Please wait...
                  </span>
                ) : (
                  isSignup ? 'Create account' : 'Sign in'
                )}
              </button>
            </form>

            {/* Toggle mode */}
            <div className={`mt-6 pt-6 text-center border-t ${
              isDark ? 'border-border-dark' : 'border-border'
            }`}>
              <p className={`text-body-sm ${
                isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'
              }`}>
                {isSignup ? 'Already have an account?' : "Don't have an account?"}{' '}
                <button
                  type="button"
                  onClick={toggleMode}
                  className="font-medium text-primary-500 hover:text-primary-600 transition-colors"
                >
                  {isSignup ? 'Sign in' : 'Sign up'}
                </button>
              </p>
            </div>
          </div>

          {/* Footer */}
          <p className={`text-center text-caption mt-6 ${
            isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'
          }`}>
            Testing & Engineering LLM Agents
          </p>
        </motion.div>
      </main>
    </div>
  )
}
