import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { AlertCircle, Loader2, Sparkles, Check } from 'lucide-react'
import { apiClient } from '../services/ApiClient'
import type { PublicProjectInfo, JoinProgressResponse } from '../lib/api-types'
import Cookies from 'js-cookie'

// Cookie configuration
const COOKIE_PREFIX = 'stella_public_'
const COOKIE_EXPIRY_DAYS = 365

// --- STYLES ---
const Styles = () => (
  <style>{`
    @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600&display=swap');

    .font-serif {
      font-family: 'Playfair Display', serif;
    }

    @keyframes gradient-shift {
      0%, 100% { background-position: 0% 50%; }
      50% { background-position: 100% 50%; }
    }

    @keyframes pulse-glow {
      0%, 100% { opacity: 0.4; }
      50% { opacity: 0.8; }
    }

    .animate-gradient { animation: gradient-shift 8s ease infinite; }
    .animate-pulse-glow { animation: pulse-glow 2s ease-in-out infinite; }
  `}</style>
)

// --- BACKGROUND ---
const BackgroundEffects = () => (
  <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
    {/* Base Gradient */}
    <div className="absolute inset-0 bg-gradient-to-b from-[#030305] via-[#050508] to-[#0a0a12]" />

    {/* Nebula Clouds */}
    <div
      className="absolute inset-0 opacity-20"
      style={{
        backgroundImage: 'radial-gradient(circle at 30% 20%, rgba(124, 58, 237, 0.2) 0%, transparent 50%), radial-gradient(circle at 70% 80%, rgba(6, 182, 212, 0.15) 0%, transparent 50%)',
        filter: 'blur(80px)',
      }}
    />

    {/* Grid Overlay */}
    <div
      className="absolute inset-0 opacity-[0.08]"
      style={{
        backgroundImage: `linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)`,
        backgroundSize: '60px 60px',
        maskImage: 'radial-gradient(circle at center, black 0%, transparent 70%)'
      }}
    />
  </div>
)

// State machine states
type PageState =
  | 'LOADING'
  | 'ERROR'
  | 'READY'       // Ready to join, show waiting screen
  | 'JOINING'     // SSE-based joining with progress updates
  | 'REDIRECTING' // Redirecting to /join/:invitationToken

// Polling configuration
const POLL_INTERVAL_MS = 500

export default function PublicProjectJoinPage() {
  const { publicToken } = useParams<{ publicToken: string }>()
  const navigate = useNavigate()

  // State machine
  const [pageState, setPageState] = useState<PageState>('LOADING')
  const [error, setError] = useState<string | null>(null)

  // Project info
  const [projectInfo, setProjectInfo] = useState<PublicProjectInfo | null>(null)

  // Remember session checkbox - defaults to false, user must explicitly opt-in
  const [rememberSession, setRememberSession] = useState(false)

  // Join progress tracking
  const [progress, setProgress] = useState<JoinProgressResponse>({
    step: 0,
    totalSteps: 5,
    status: 'in_progress',
    message: 'Starting...'
  })

  // Polling cleanup ref
  const pollingRef = useRef<{ active: boolean }>({ active: false })

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      pollingRef.current.active = false
    }
  }, [])

  // Check for existing cookie and redirect if found
  useEffect(() => {
    if (!publicToken) {
      setError('Invalid public project link')
      setPageState('ERROR')
      return
    }

    // Check for existing invitation token in cookie
    const existingToken = Cookies.get(`${COOKIE_PREFIX}${publicToken}`)
    if (existingToken) {
      // Redirect directly to existing invitation
      navigate(`/join/${existingToken}`, { replace: true })
      return
    }

    // Load project info
    const loadProjectInfo = async () => {
      try {
        const info = await apiClient.getPublicProject(publicToken)
        setProjectInfo(info)

        // Check for errors
        if (!info.isEnabled) {
          setError('This public project is currently disabled.')
          setPageState('ERROR')
          return
        }

        if (info.isExpired) {
          setError('This public project link has expired.')
          setPageState('ERROR')
          return
        }

        setPageState('READY')
      } catch (err: any) {
        console.error('Failed to load public project:', err)
        if (err.statusCode === 404) {
          setError('Public project not found. The link may be invalid.')
        } else {
          setError(err.message || 'Failed to load project')
        }
        setPageState('ERROR')
      }
    }

    loadProjectInfo()
  }, [publicToken, navigate])

  // Handle join button click - uses polling for progress
  const handleJoin = useCallback(async () => {
    if (!publicToken) return

    setPageState('JOINING')
    setProgress({ step: 0, totalSteps: 5, status: 'in_progress', message: 'Connecting...' })

    try {
      // Start the join process (non-blocking)
      const { sessionId } = await apiClient.startJoinPublicProject(publicToken)

      // Start polling for progress
      pollingRef.current.active = true

      const poll = async () => {
        if (!pollingRef.current.active) return

        try {
          const status = await apiClient.getJoinProgress(publicToken, sessionId)
          setProgress(status)

          // Handle completion
          if (status.status === 'complete' && status.invitationToken) {
            pollingRef.current.active = false

            // Save invitation token to cookie if "remember" is checked
            if (rememberSession) {
              Cookies.set(`${COOKIE_PREFIX}${publicToken}`, status.invitationToken, {
                expires: COOKIE_EXPIRY_DAYS,
                sameSite: 'lax',
              })
            }

            setPageState('REDIRECTING')
            navigate(`/join/${status.invitationToken}`, { replace: true })
            return
          }

          // Handle failure
          if (status.status === 'failed') {
            pollingRef.current.active = false
            setError(status.error || 'Failed to join. Please try again.')
            setPageState('ERROR')
            return
          }

          // Continue polling if still in progress
          if (pollingRef.current.active) {
            setTimeout(poll, POLL_INTERVAL_MS)
          }
        } catch (err: any) {
          console.error('Failed to get join progress:', err)
          // Continue polling even on error (transient network issues)
          if (pollingRef.current.active) {
            setTimeout(poll, POLL_INTERVAL_MS * 2) // Slow down on error
          }
        }
      }

      // Start polling
      poll()
    } catch (err: any) {
      console.error('Failed to start joining public project:', err)
      setError(err.message || 'Failed to join. Please try again.')
      setPageState('ERROR')
    }
  }, [publicToken, rememberSession, navigate])

  return (
    <>
      <Styles />
      <div className="min-h-screen w-full text-white selection:bg-violet-500/30 selection:text-white">
        <BackgroundEffects />

        <AnimatePresence mode="wait">
          {/* LOADING State */}
          {pageState === 'LOADING' && (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 flex items-center justify-center z-10"
            >
              <div className="text-center">
                <Loader2 className="w-8 h-8 animate-spin text-violet-400 mx-auto mb-4" />
                <p className="text-white/50 text-sm">Loading...</p>
              </div>
            </motion.div>
          )}

          {/* ERROR State */}
          {pageState === 'ERROR' && (
            <motion.div
              key="error"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 flex items-center justify-center z-10 p-6"
            >
              <div className="max-w-md w-full">
                {/* STELLA Branding */}
                <div className="text-center mb-8">
                  <h1 className="font-serif text-4xl font-medium tracking-[0.15em] text-white mb-2">
                    STELLA
                  </h1>
                  <p className="text-white/30 text-xs tracking-wide">
                    System for Testing and Engineering LLM-based conversational Agents
                  </p>
                </div>

                {/* Error Card */}
                <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8">
                  <div className="flex flex-col items-center text-center">
                    <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mb-4">
                      <AlertCircle className="w-6 h-6 text-red-400" />
                    </div>
                    <h2 className="text-lg font-light text-white mb-2">
                      Unable to Access
                    </h2>
                    <p className="text-white/50 text-sm">
                      {error}
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* READY State - Show join screen */}
          {pageState === 'READY' && projectInfo && (
            <motion.div
              key="ready"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 flex items-center justify-center z-10 p-6"
            >
              <div className="max-w-md w-full">
                {/* STELLA Branding */}
                <div className="text-center mb-8">
                  <h1 className="font-serif text-4xl font-medium tracking-[0.15em] text-white mb-2">
                    STELLA
                  </h1>
                  <p className="text-white/30 text-xs tracking-wide">
                    System for Testing and Engineering LLM-based conversational Agents
                  </p>
                </div>

                {/* Join Card */}
                <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8">
                  <div className="flex flex-col items-center text-center">
                    {/* Agent Icon */}
                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-violet-500/20 to-cyan-500/20 flex items-center justify-center mb-4 border border-white/10">
                      <span className="text-3xl">
                        {projectInfo.agentIcon || '🤖'}
                      </span>
                    </div>

                    {/* Project Name */}
                    <h2 className="text-xl font-light text-white mb-2">
                      {projectInfo.projectName}
                    </h2>

                    {/* Agent Name */}
                    <p className="text-white/50 text-sm mb-6">
                      Powered by {projectInfo.agentName}
                    </p>

                    {/* Remember Session Checkbox */}
                    <label className="flex items-center gap-3 cursor-pointer mb-6 text-sm text-white/60 hover:text-white/80 transition-colors">
                      <input
                        type="checkbox"
                        checked={rememberSession}
                        onChange={(e) => setRememberSession(e.target.checked)}
                        className="w-4 h-4 rounded border-white/20 bg-white/5 text-violet-500 focus:ring-violet-500 focus:ring-offset-0"
                      />
                      Remember my session on this device
                    </label>

                    {/* Join Button */}
                    <button
                      onClick={handleJoin}
                      className="w-full py-4 px-6 bg-gradient-to-r from-violet-600 to-violet-500 hover:from-violet-500 hover:to-violet-400 rounded-xl text-white font-medium transition-all duration-300 flex items-center justify-center gap-2 shadow-lg shadow-violet-500/20"
                    >
                      <Sparkles className="w-5 h-5" />
                      Start Session
                    </button>

                    <p className="text-white/30 text-xs mt-4">
                      A private session will be created just for you
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* JOINING State - Creating session with progress updates */}
          {pageState === 'JOINING' && projectInfo && (
            <motion.div
              key="joining"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 flex items-center justify-center z-10 p-6"
            >
              <div className="max-w-md w-full">
                {/* STELLA Branding */}
                <div className="text-center mb-8">
                  <h1 className="font-serif text-4xl font-medium tracking-[0.15em] text-white mb-2">
                    STELLA
                  </h1>
                  <p className="text-white/30 text-xs tracking-wide">
                    System for Testing and Engineering LLM-based conversational Agents
                  </p>
                </div>

                {/* Preparing Card */}
                <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8">
                  <div className="flex flex-col items-center text-center">
                    {/* Animated Agent Icon */}
                    <div className="relative w-20 h-20 mb-6">
                      {/* Pulsing ring */}
                      <div className="absolute inset-0 rounded-full bg-gradient-to-r from-violet-500/30 to-cyan-500/30 animate-pulse-glow" />
                      <div className="absolute inset-2 rounded-full bg-gradient-to-br from-violet-500/20 to-cyan-500/20 flex items-center justify-center border border-white/10">
                        <span className="text-3xl">
                          {projectInfo.agentIcon || '🤖'}
                        </span>
                      </div>
                    </div>

                    <h2 className="text-xl font-light text-white mb-2">
                      {progress.message}
                    </h2>

                    <p className="text-white/50 text-sm mb-6">
                      {projectInfo.agentName} is getting ready...
                    </p>

                    {/* Step dots */}
                    <div className="flex gap-2 mb-4">
                      {Array.from({ length: progress.totalSteps }, (_, i) => i + 1).map((s) => (
                        <motion.div
                          key={s}
                          className={`w-3 h-3 rounded-full flex items-center justify-center transition-colors duration-300 ${
                            s < progress.step
                              ? 'bg-emerald-500'
                              : s === progress.step
                              ? 'bg-violet-500'
                              : 'bg-white/20'
                          }`}
                          initial={false}
                          animate={{
                            scale: s === progress.step ? [1, 1.2, 1] : 1,
                          }}
                          transition={{
                            duration: 0.5,
                            repeat: s === progress.step ? Infinity : 0,
                            repeatType: 'reverse',
                          }}
                        >
                          {s < progress.step && (
                            <Check className="w-2 h-2 text-white" />
                          )}
                        </motion.div>
                      ))}
                    </div>

                    {/* Progress bar */}
                    <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
                      <motion.div
                        className="h-full bg-gradient-to-r from-violet-500 to-cyan-500"
                        initial={{ width: '0%' }}
                        animate={{ width: `${(progress.step / progress.totalSteps) * 100}%` }}
                        transition={{ duration: 0.3, ease: 'easeOut' }}
                      />
                    </div>

                    <p className="text-white/30 text-xs mt-4">
                      Step {progress.step || 1} of {progress.totalSteps}
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* REDIRECTING State */}
          {pageState === 'REDIRECTING' && (
            <motion.div
              key="redirecting"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 flex items-center justify-center z-10"
            >
              <div className="text-center">
                <Loader2 className="w-8 h-8 animate-spin text-violet-400 mx-auto mb-4" />
                <p className="text-white/50 text-sm">Connecting to your session...</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </>
  )
}
