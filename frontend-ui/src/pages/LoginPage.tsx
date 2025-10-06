import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useAuthStore } from '../store/authStore'
import LoginBackground from '../components/animations/LoginBackground'

export default function LoginPage() {
  const navigate = useNavigate()
  const { login, signup, isLoading, isAuthenticated, error, signupSuccess, clearError } = useAuthStore()

  // Redirect to dashboard if already authenticated
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
        // After signup, clear form and switch to login mode to show success message
        setFormData({ email: '', password: '', name: '' })
        setIsSignup(false)
      } else {
        await login(formData.email, formData.password)
        // Only navigate to dashboard after successful login
        navigate('/dashboard')
      }
    } catch (error) {
      // Error is handled by the store
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
    <div className="min-h-screen flex items-center justify-center p-4">
      <LoginBackground />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-md"
      >
        {/* Logo/Title */}
        <motion.div
          className="text-center mb-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2, duration: 0.6 }}
        >
          <h1 className="text-4xl font-thin text-neutral-900 tracking-wider mb-2">
            Grace AI
          </h1>
          <p className="text-sm text-neutral-500 font-light tracking-wide">
            Session Management & Test Suite
          </p>
        </motion.div>

        {/* Login/Signup Card */}
        <motion.div
          className="
            bg-white/95 backdrop-blur-xl border border-neutral-200/60
            rounded-[24px] shadow-[0_1px_40px_rgba(0,0,0,0.08)]
            p-8
          "
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.3, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="mb-6">
            <h2 className="text-2xl font-light text-neutral-900 tracking-wide">
              {isSignup ? 'Create Account' : 'Welcome Back'}
            </h2>
            <p className="text-sm text-neutral-500 font-light mt-1">
              {isSignup
                ? 'Sign up to get started with Grace AI'
                : 'Sign in to continue to your dashboard'}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Name field (signup only) */}
            {isSignup && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.3 }}
              >
                <label className="block text-xs font-light text-neutral-600 tracking-wider uppercase mb-2">
                  Name
                </label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleInputChange}
                  required={isSignup}
                  className="
                    w-full px-4 py-3 rounded-xl
                    bg-neutral-50/50 border border-neutral-200/60
                    text-neutral-900 text-sm font-light
                    focus:outline-none focus:border-neutral-400/60 focus:bg-white
                    transition-all duration-200
                    placeholder:text-neutral-400
                  "
                  placeholder="Enter your name"
                />
              </motion.div>
            )}

            {/* Email field */}
            <div>
              <label className="block text-xs font-light text-neutral-600 tracking-wider uppercase mb-2">
                Email
              </label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                required
                className="
                  w-full px-4 py-3 rounded-xl
                  bg-neutral-50/50 border border-neutral-200/60
                  text-neutral-900 text-sm font-light
                  focus:outline-none focus:border-neutral-400/60 focus:bg-white
                  transition-all duration-200
                  placeholder:text-neutral-400
                "
                placeholder="Enter your email"
              />
            </div>

            {/* Password field */}
            <div>
              <label className="block text-xs font-light text-neutral-600 tracking-wider uppercase mb-2">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  name="password"
                  value={formData.password}
                  onChange={handleInputChange}
                  required
                  className="
                    w-full px-4 py-3 pr-12 rounded-xl
                    bg-neutral-50/50 border border-neutral-200/60
                    text-neutral-900 text-sm font-light
                    focus:outline-none focus:border-neutral-400/60 focus:bg-white
                    transition-all duration-200
                    placeholder:text-neutral-400
                  "
                  placeholder="Enter your password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="
                    absolute right-3 top-1/2 -translate-y-1/2
                    text-neutral-400 hover:text-neutral-600
                    transition-colors duration-200
                    focus:outline-none
                  "
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Success message (after signup) */}
            {signupSuccess && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 rounded-lg bg-green-50/80 border border-green-200/60 text-green-700 text-sm font-light"
              >
                <div className="font-normal mb-1">✓ Account Created</div>
                <div className="text-xs">{signupSuccess}</div>
              </motion.div>
            )}

            {/* Error message */}
            {error && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-3 rounded-lg bg-red-50/80 border border-red-200/60 text-red-600 text-xs font-light"
              >
                {error}
              </motion.div>
            )}

            {/* Submit button */}
            <motion.button
              type="submit"
              disabled={isLoading}
              className="
                w-full py-3 px-4 rounded-xl
                bg-neutral-900 text-white text-sm font-light tracking-wider
                hover:bg-neutral-800
                disabled:opacity-60 disabled:cursor-not-allowed
                shadow-[0_1px_20px_rgba(0,0,0,0.12)]
                transition-all duration-200
              "
              whileHover={{ scale: 1.01 }}
              whileTap={{ scale: 0.99 }}
            >
              {isLoading
                ? 'Please wait...'
                : isSignup
                  ? 'Create Account'
                  : 'Sign In'}
            </motion.button>
          </form>

          {/* Toggle mode */}
          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={toggleMode}
              className="text-sm text-neutral-600 hover:text-neutral-900 font-light transition-colors duration-200"
            >
              {isSignup ? (
                <>
                  Already have an account?{' '}
                  <span className="font-normal">Sign in</span>
                </>
              ) : (
                <>
                  Don't have an account?{' '}
                  <span className="font-normal">Sign up</span>
                </>
              )}
            </button>
          </div>
        </motion.div>

      </motion.div>
    </div>
  )
}
