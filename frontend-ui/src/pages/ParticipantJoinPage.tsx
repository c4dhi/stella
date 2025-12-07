import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { AlertCircle, Loader2, Clock, RefreshCw } from 'lucide-react'
import { apiClient } from '../services/ApiClient'
import type { InvitationDetails, AcceptInvitationResponse, InvitationStatus } from '../lib/api-types'
import { checkMicrophonePermission } from '../lib/mediaDevices'
import TermsModal from '../components/participant/TermsModal'
import OrganizerMessageModal from '../components/participant/OrganizerMessageModal'
import PermissionsModal from '../components/participant/PermissionsModal'
import ParticipantSessionView from '../components/participant/ParticipantSessionView'

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

    .animate-gradient { animation: gradient-shift 8s ease infinite; }
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
  | 'TERMS_MODAL'
  | 'MESSAGE_MODAL'
  | 'PERMISSIONS_CHECK'  // Device permissions screen
  | 'WAITING'      // When participant is active, waiting in queue
  | 'SESSION_VIEW'

interface ConnectionInfo {
  token: string
  serverUrl: string
  roomName: string
}

interface SessionData {
  participantId: string
  participantName: string
  identity: string
  sessionId: string
  authToken: string  // Participant JWT for API calls
  connectionInfo: ConnectionInfo
  visualizerType: string | null
  visualizerLocked: boolean
}

export default function ParticipantJoinPage() {
  const { token } = useParams<{ token: string }>()

  // State machine
  const [pageState, setPageState] = useState<PageState>('LOADING')
  const [error, setError] = useState<string | null>(null)

  // Invitation data
  const [invitation, setInvitation] = useState<InvitationDetails | null>(null)

  // Session data (after accepting invitation)
  const [sessionData, setSessionData] = useState<SessionData | null>(null)

  // Load invitation details
  useEffect(() => {
    if (!token) {
      setError('Invalid invitation link')
      setPageState('ERROR')
      return
    }

    const loadInvitation = async () => {
      try {
        const data = await apiClient.getPublicInvitation(token)
        setInvitation(data)

        // Handle based on status
        if (data.status === 'PENDING') {
          // New invitation - show terms modal
          setPageState('TERMS_MODAL')
        } else if (data.status === 'ACCEPTED') {
          // Already accepted - check if we can rejoin
          if (data.participant?.isActive) {
            // Someone is currently using this session - wait
            setPageState('WAITING')
          } else {
            // Participant is not active - can rejoin directly
            handleRejoinInvitation()
          }
        } else {
          // EXPIRED or REVOKED
          const statusMessages: Record<InvitationStatus, string> = {
            PENDING: '',
            ACCEPTED: '',
            EXPIRED: 'This invitation has expired.',
            REVOKED: 'This invitation has been revoked.',
          }
          setError(statusMessages[data.status] || 'This invitation is no longer valid.')
          setPageState('ERROR')
        }
      } catch (err: any) {
        console.error('Failed to load invitation:', err)
        if (err.statusCode === 404) {
          setError('Invitation not found. The link may be invalid or expired.')
        } else {
          setError(err.message || 'Failed to load invitation')
        }
        setPageState('ERROR')
      }
    }

    loadInvitation()
  }, [token])

  // Auto-poll when in WAITING state to check if participant becomes inactive
  useEffect(() => {
    if (pageState !== 'WAITING' || !token) return

    const POLL_INTERVAL = 5000 // Check every 5 seconds

    const checkAndRejoin = async () => {
      try {
        const data = await apiClient.getPublicInvitation(token)

        // If invitation was revoked or expired while waiting, show error
        if (data.status === 'REVOKED' || data.status === 'EXPIRED') {
          setError(data.status === 'REVOKED'
            ? 'This invitation has been revoked.'
            : 'This invitation has expired.')
          setPageState('ERROR')
          return
        }

        // If participant is no longer active, try to rejoin
        if (data.status === 'ACCEPTED' && !data.participant?.isActive) {
          // Attempt to rejoin - this will handle success or if someone else got there first
          try {
            const response: AcceptInvitationResponse = await apiClient.rejoinInvitation(token)
            setSessionData({
              participantId: response.participantId,
              participantName: response.participantName,
              identity: response.identity,
              sessionId: response.sessionId,
              authToken: response.token,
              connectionInfo: response.connectionInfo,
              visualizerType: response.visualizerType ?? null,
              visualizerLocked: response.visualizerLocked,
            })
            setPageState('SESSION_VIEW')
          } catch (rejoinErr: any) {
            // If rejoin fails because someone else joined, stay in waiting
            if (rejoinErr.message?.includes('currently in use')) {
              // Stay in WAITING state, poll will retry
            } else {
              console.error('Failed to auto-rejoin:', rejoinErr)
            }
          }
        }
      } catch (err) {
        console.error('Failed to check invitation status:', err)
        // Don't change state on poll errors, just log and retry
      }
    }

    const intervalId = setInterval(checkAndRejoin, POLL_INTERVAL)

    return () => clearInterval(intervalId)
  }, [pageState, token])

  // Accept invitation and join session
  const handleAcceptInvitation = useCallback(async () => {
    if (!token) return

    setPageState('LOADING')

    try {
      const response: AcceptInvitationResponse = await apiClient.acceptInvitation(token)

      setSessionData({
        participantId: response.participantId,
        participantName: response.participantName,
        identity: response.identity,
        sessionId: response.sessionId,
        authToken: response.token,  // Participant JWT for API calls
        connectionInfo: response.connectionInfo,
        visualizerType: response.visualizerType ?? null,
        visualizerLocked: response.visualizerLocked,
      })

      setPageState('SESSION_VIEW')
    } catch (err: any) {
      console.error('Failed to accept invitation:', err)
      setError(err.message || 'Failed to join session')
      setPageState('ERROR')
    }
  }, [token])

  // Check if we need to show permissions screen
  const checkAndProceed = useCallback(async () => {
    const micPermission = await checkMicrophonePermission()

    if (micPermission === 'granted') {
      // Skip permissions screen, go straight to accept
      await handleAcceptInvitation()
    } else {
      // Show permissions screen
      setPageState('PERMISSIONS_CHECK')
    }
  }, [handleAcceptInvitation])

  // Handle terms acceptance
  const handleTermsAccepted = useCallback(() => {
    if (invitation?.customMessage) {
      setPageState('MESSAGE_MODAL')
    } else {
      // No custom message, check permissions
      checkAndProceed()
    }
  }, [invitation, checkAndProceed])

  // Handle message acknowledgment
  const handleMessageAcknowledged = useCallback(() => {
    checkAndProceed()
  }, [checkAndProceed])

  // Handle permissions complete
  const handlePermissionsComplete = useCallback(async () => {
    await handleAcceptInvitation()
  }, [handleAcceptInvitation])

  // Rejoin an already accepted invitation
  const handleRejoinInvitation = useCallback(async () => {
    if (!token) return

    setPageState('LOADING')

    try {
      const response: AcceptInvitationResponse = await apiClient.rejoinInvitation(token)

      setSessionData({
        participantId: response.participantId,
        participantName: response.participantName,
        identity: response.identity,
        sessionId: response.sessionId,
        authToken: response.token,  // Participant JWT for API calls
        connectionInfo: response.connectionInfo,
        visualizerType: response.visualizerType ?? null,
        visualizerLocked: response.visualizerLocked,
      })

      setPageState('SESSION_VIEW')
    } catch (err: any) {
      console.error('Failed to rejoin invitation:', err)
      // If participant is active, show waiting screen
      if (err.message?.includes('currently in use')) {
        setPageState('WAITING')
      } else {
        setError(err.message || 'Failed to rejoin session')
        setPageState('ERROR')
      }
    }
  }, [token])

  // Retry joining (for waiting screen)
  const handleRetryJoin = useCallback(() => {
    handleRejoinInvitation()
  }, [handleRejoinInvitation])

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
                <p className="text-white/50 text-sm">Loading invitation...</p>
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
                    Intelligent Voice Agents
                  </p>
                </div>

                {/* Error Card */}
                <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8">
                  <div className="flex flex-col items-center text-center">
                    <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mb-4">
                      <AlertCircle className="w-6 h-6 text-red-400" />
                    </div>
                    <h2 className="text-lg font-light text-white mb-2">
                      Unable to Join
                    </h2>
                    <p className="text-white/50 text-sm">
                      {error}
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* TERMS_MODAL State */}
          {pageState === 'TERMS_MODAL' && invitation && (
            <TermsModal
              key="terms"
              participantName={invitation.participantName}
              onAccept={handleTermsAccepted}
            />
          )}

          {/* MESSAGE_MODAL State */}
          {pageState === 'MESSAGE_MODAL' && invitation && (
            <OrganizerMessageModal
              key="message"
              message={invitation.customMessage!}
              participantName={invitation.participantName}
              onContinue={handleMessageAcknowledged}
            />
          )}

          {/* PERMISSIONS_CHECK State */}
          {pageState === 'PERMISSIONS_CHECK' && invitation && (
            <PermissionsModal
              key="permissions"
              isOpen={true}
              participantName={invitation.participantName}
              onComplete={handlePermissionsComplete}
            />
          )}

          {/* WAITING State - Session in use by another participant */}
          {pageState === 'WAITING' && invitation && (
            <motion.div
              key="waiting"
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
                    Intelligent Voice Agents
                  </p>
                </div>

                {/* Waiting Card */}
                <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-8">
                  <div className="flex flex-col items-center text-center">
                    <div className="w-12 h-12 rounded-full bg-amber-500/10 flex items-center justify-center mb-4">
                      <Clock className="w-6 h-6 text-amber-400" />
                    </div>
                    <h2 className="text-lg font-light text-white mb-2">
                      Session In Use
                    </h2>
                    <p className="text-white/50 text-sm mb-4">
                      The session is currently being used by another participant.
                    </p>

                    {/* Auto-checking indicator */}
                    <div className="flex items-center gap-2 text-white/40 text-xs mb-6">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      <span>Auto-checking availability...</span>
                    </div>

                    {/* Participant name */}
                    <div className="w-full py-3 px-4 bg-white/5 rounded-xl border border-white/10 mb-6">
                      <p className="text-white/40 text-xs uppercase tracking-wider mb-1">Joining as</p>
                      <p className="text-white font-light">{invitation.participantName}</p>
                    </div>

                    {/* Retry button */}
                    <button
                      onClick={handleRetryJoin}
                      className="w-full py-3 px-6 bg-white/10 hover:bg-white/20 border border-white/10 rounded-xl text-white font-light transition-all duration-300 flex items-center justify-center gap-2"
                    >
                      <RefreshCw className="w-4 h-4" />
                      Check Now
                    </button>

                    <p className="text-white/30 text-xs mt-4">
                      You'll automatically join when available
                    </p>
                  </div>
                </div>
              </div>
            </motion.div>
          )}

          {/* SESSION_VIEW State */}
          {pageState === 'SESSION_VIEW' && sessionData && (
            <ParticipantSessionView
              key="session"
              sessionData={sessionData}
            />
          )}
        </AnimatePresence>
      </div>
    </>
  )
}
