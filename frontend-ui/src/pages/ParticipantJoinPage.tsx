import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { AlertCircle, Loader2 } from 'lucide-react'
import { apiClient } from '../services/ApiClient'
import type { InvitationDetails, AcceptInvitationResponse, InvitationStatus } from '../lib/api-types'
import TermsModal from '../components/participant/TermsModal'
import OrganizerMessageModal from '../components/participant/OrganizerMessageModal'
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

        // Check if invitation is still valid
        if (data.status !== 'PENDING') {
          const statusMessages: Record<InvitationStatus, string> = {
            PENDING: '',
            ACCEPTED: 'This invitation has already been used.',
            EXPIRED: 'This invitation has expired.',
            REVOKED: 'This invitation has been revoked.',
          }
          setError(statusMessages[data.status] || 'This invitation is no longer valid.')
          setPageState('ERROR')
          return
        }

        // Move to terms modal
        setPageState('TERMS_MODAL')
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

  // Handle terms acceptance
  const handleTermsAccepted = useCallback(() => {
    if (invitation?.customMessage) {
      setPageState('MESSAGE_MODAL')
    } else {
      // No custom message, proceed to accept invitation
      handleAcceptInvitation()
    }
  }, [invitation])

  // Handle message acknowledgment
  const handleMessageAcknowledged = useCallback(() => {
    handleAcceptInvitation()
  }, [])

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
