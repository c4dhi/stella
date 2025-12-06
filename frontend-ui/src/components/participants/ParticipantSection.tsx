import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useThemeStore } from '../../store/themeStore'
import { apiClient } from '../../services/ApiClient'
import type { Participant, Invitation, InvitationStatus, SessionEvent } from '../../lib/api-types'
import PresenceIndicator from './PresenceIndicator'
import InviteParticipantModal from '../modals/InviteParticipantModal'

interface ParticipantSectionProps {
  sessionId: string
  participants: Participant[]
  onShowConnectionInfo: (participantId: string) => void
  onRemoveParticipant: (participantId: string, participantName: string) => void
  onRefresh?: () => void
}

// Track online status by identity
interface PresenceState {
  [identity: string]: boolean
}

export default function ParticipantSection({
  sessionId,
  participants,
  onShowConnectionInfo,
  onRemoveParticipant,
  onRefresh,
}: ParticipantSectionProps) {
  const { resolvedTheme } = useThemeStore()
  const isDark = resolvedTheme === 'dark'

  // Local state
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false)
  const [invitations, setInvitations] = useState<Invitation[]>([])
  const [isLoadingInvitations, setIsLoadingInvitations] = useState(false)
  const [presenceState, setPresenceState] = useState<PresenceState>({})

  // Check if we already have a participant (UI limit)
  const hasParticipant = participants.filter(p => !p.leftAt).length > 0
  const hasPendingInvitation = invitations.some(inv => inv.status === 'PENDING')

  // Fetch invitations
  const fetchInvitations = useCallback(async () => {
    try {
      setIsLoadingInvitations(true)
      const data = await apiClient.listInvitations(sessionId)
      setInvitations(data)

      // Initialize presence state from invitations with participants
      const newPresence: PresenceState = {}
      data.forEach(inv => {
        if (inv.participant) {
          // If lastSeenAt is recent (within 30 seconds) and leftAt is null, consider online
          const isOnline = !inv.participant.leftAt && inv.participant.lastSeenAt
            ? Date.now() - new Date(inv.participant.lastSeenAt).getTime() < 30000
            : !inv.participant.leftAt
          newPresence[inv.participant.identity] = isOnline
        }
      })
      setPresenceState(prev => ({ ...prev, ...newPresence }))
    } catch (err) {
      console.error('Failed to fetch invitations:', err)
    } finally {
      setIsLoadingInvitations(false)
    }
  }, [sessionId])

  // Load invitations on mount
  useEffect(() => {
    fetchInvitations()
  }, [fetchInvitations])

  // Subscribe to SSE events for presence updates
  useEffect(() => {
    const cleanup = apiClient.subscribeToSessionEvents(
      sessionId,
      (event: SessionEvent) => {
        if (event.type === 'participant.joined' && event.participantIdentity) {
          setPresenceState(prev => ({
            ...prev,
            [event.participantIdentity!]: true,
          }))
          // Refresh invitations to get updated participant data
          fetchInvitations()
        } else if (event.type === 'participant.left' && event.participantIdentity) {
          setPresenceState(prev => ({
            ...prev,
            [event.participantIdentity!]: false,
          }))
        }
      },
      (error) => {
        console.error('SSE error:', error)
      }
    )

    return cleanup
  }, [sessionId, fetchInvitations])

  // Handle invitation created
  const handleInvitationCreated = () => {
    fetchInvitations()
    onRefresh?.()
  }

  // Handle revoke invitation
  const handleRevokeInvitation = async (invitationId: string) => {
    try {
      await apiClient.revokeInvitation(invitationId)
      fetchInvitations()
    } catch (err) {
      console.error('Failed to revoke invitation:', err)
    }
  }

  // Get presence status for a participant
  const isParticipantOnline = (identity: string): boolean => {
    return presenceState[identity] ?? false
  }

  // Format expiration time
  const formatExpiration = (expiresAt: string | null | undefined): string => {
    if (!expiresAt) return 'Never expires'
    const date = new Date(expiresAt)
    const now = new Date()
    const diff = date.getTime() - now.getTime()

    if (diff < 0) return 'Expired'
    if (diff < 3600000) return `${Math.ceil(diff / 60000)}m left`
    if (diff < 86400000) return `${Math.ceil(diff / 3600000)}h left`
    return `${Math.ceil(diff / 86400000)}d left`
  }

  // Get status badge color
  const getStatusColor = (status: InvitationStatus): string => {
    switch (status) {
      case 'PENDING':
        return isDark ? 'bg-yellow-500/20 text-yellow-300' : 'bg-yellow-50 text-yellow-600'
      case 'ACCEPTED':
        return isDark ? 'bg-green-500/20 text-green-300' : 'bg-green-50 text-green-600'
      case 'EXPIRED':
        return isDark ? 'bg-zinc-500/20 text-zinc-400' : 'bg-neutral-100 text-neutral-500'
      case 'REVOKED':
        return isDark ? 'bg-red-500/20 text-red-300' : 'bg-red-50 text-red-600'
      default:
        return isDark ? 'bg-zinc-500/20 text-zinc-400' : 'bg-neutral-100 text-neutral-500'
    }
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
        className="w-80 flex flex-col"
      >
        {/* Participants Panel */}
        <div
          className={`
            backdrop-blur-xl rounded-[16px] flex flex-col overflow-hidden
            ${isDark
              ? 'bg-white/5 border border-white/10'
              : 'bg-white border border-border shadow-sm'
            }
          `}
        >
          {/* Header */}
          <div className={`p-4 border-b ${isDark ? 'border-white/10' : 'border-border'}`}>
            <h2 className={`text-lg font-thin tracking-wider mb-1 ${isDark ? 'text-content-inverse' : 'text-content'}`}>
              Participants
            </h2>
            <p className={`text-[10px] font-light tracking-wider uppercase ${isDark ? 'text-content-inverse-secondary' : 'text-content-tertiary'}`}>
              {participants.filter(p => !p.leftAt).length} active
              {invitations.filter(i => i.status === 'PENDING').length > 0 && (
                <span className="ml-2">
                  · {invitations.filter(i => i.status === 'PENDING').length} pending
                </span>
              )}
            </p>
          </div>

          {/* Invite Button */}
          <div className={`p-4 border-b ${isDark ? 'border-white/10' : 'border-border'}`}>
            <button
              onClick={() => setIsInviteModalOpen(true)}
              disabled={hasParticipant || hasPendingInvitation}
              className={`
                w-full py-2.5 px-4 rounded-xl text-sm font-light tracking-wider
                transition-all duration-200 flex items-center justify-center gap-2
                disabled:opacity-50 disabled:cursor-not-allowed
                ${isDark
                  ? 'bg-primary-500 text-white hover:bg-primary-400 hover:shadow-primary border border-primary-400/30'
                  : 'bg-neutral-900 text-white hover:bg-neutral-800 shadow-sm'
                }
              `}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
              >
                <path d="M12 5v14M5 12h14" />
              </svg>
              Invite Participant
            </button>
            {(hasParticipant || hasPendingInvitation) && (
              <p className={`text-[10px] mt-2 text-center ${isDark ? 'text-zinc-500' : 'text-neutral-400'}`}>
                {hasPendingInvitation ? 'Pending invitation exists' : 'One participant per session'}
              </p>
            )}
          </div>

          {/* Invitations & Participants List */}
          <div className="p-4 space-y-3 max-h-80 overflow-y-auto">
            {isLoadingInvitations && invitations.length === 0 ? (
              <div className={`text-center py-8 text-sm font-light ${isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'}`}>
                Loading...
              </div>
            ) : invitations.length === 0 ? (
              <div className={`text-center py-8 text-sm font-light ${isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'}`}>
                No invitations yet
              </div>
            ) : (
              <AnimatePresence>
                {invitations.map(invitation => (
                  <motion.div
                    key={invitation.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className={`
                      p-4 rounded-xl transition-all duration-200
                      ${isDark
                        ? 'bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20'
                        : 'bg-surface-secondary border border-border hover:bg-surface-tertiary hover:border-border-secondary'
                      }
                    `}
                  >
                    {/* Name & Presence */}
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {invitation.participant && (
                          <PresenceIndicator
                            isOnline={isParticipantOnline(invitation.participant.identity)}
                            size="sm"
                          />
                        )}
                        <span className={`text-sm font-light ${isDark ? 'text-content-inverse' : 'text-content'}`}>
                          {invitation.participantName}
                        </span>
                      </div>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${getStatusColor(invitation.status as InvitationStatus)}`}>
                        {invitation.status}
                      </span>
                    </div>

                    {/* Info */}
                    <div className={`text-[10px] font-light tracking-wider uppercase mb-3 ${isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'}`}>
                      {invitation.status === 'ACCEPTED' && invitation.participant ? (
                        <>
                          Joined {new Date(invitation.participant.joinedAt).toLocaleTimeString()}
                          {isParticipantOnline(invitation.participant.identity) && (
                            <span className="text-green-500 ml-2">· Online</span>
                          )}
                        </>
                      ) : invitation.status === 'PENDING' ? (
                        <>
                          Created {new Date(invitation.createdAt).toLocaleTimeString()}
                          <span className="ml-2">· {formatExpiration(invitation.expiresAt)}</span>
                        </>
                      ) : (
                        <>
                          {invitation.status === 'REVOKED' ? 'Revoked' : 'Expired'}
                        </>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex gap-2">
                      {invitation.status === 'ACCEPTED' && invitation.participant && (
                        <>
                          <button
                            onClick={() => onShowConnectionInfo(invitation.participant!.id)}
                            className={`
                              flex-1 py-1.5 px-2 rounded-lg text-xs font-light
                              transition-all duration-200 flex items-center justify-center gap-1
                              ${isDark
                                ? 'bg-white/10 border border-white/10 text-content-inverse-secondary hover:text-content-inverse hover:border-white/20'
                                : 'bg-white border border-border text-content-secondary hover:text-content hover:border-border-secondary'
                              }
                            `}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                              <circle cx="12" cy="12" r="10" />
                              <path d="M12 16v-4M12 8h.01" />
                            </svg>
                            Info
                          </button>
                          <button
                            onClick={() => onRemoveParticipant(invitation.participant!.id, invitation.participantName)}
                            className={`
                              py-1.5 px-2 rounded-lg text-xs font-light transition-all duration-200
                              ${isDark ? 'text-red-400 hover:bg-red-500/20' : 'text-red-500 hover:bg-red-50'}
                            `}
                            title="Remove participant"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                              <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6" />
                            </svg>
                          </button>
                        </>
                      )}

                      {invitation.status === 'PENDING' && (
                        <>
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(`${window.location.origin}/join/${invitation.token}`)
                            }}
                            className={`
                              flex-1 py-1.5 px-2 rounded-lg text-xs font-light
                              transition-all duration-200 flex items-center justify-center gap-1
                              ${isDark
                                ? 'bg-white/10 border border-white/10 text-content-inverse-secondary hover:text-content-inverse hover:border-white/20'
                                : 'bg-white border border-border text-content-secondary hover:text-content hover:border-border-secondary'
                              }
                            `}
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                              <rect x="9" y="9" width="13" height="13" rx="2" />
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                            Copy Link
                          </button>
                          <button
                            onClick={() => handleRevokeInvitation(invitation.id)}
                            className={`
                              py-1.5 px-2 rounded-lg text-xs font-light transition-all duration-200
                              ${isDark ? 'text-red-400 hover:bg-red-500/20' : 'text-red-500 hover:bg-red-50'}
                            `}
                            title="Revoke invitation"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                              <path d="M18 6L6 18M6 6l12 12" />
                            </svg>
                          </button>
                        </>
                      )}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            )}
          </div>
        </div>
      </motion.div>

      {/* Invite Modal */}
      <InviteParticipantModal
        isOpen={isInviteModalOpen}
        onClose={() => setIsInviteModalOpen(false)}
        sessionId={sessionId}
        onSuccess={handleInvitationCreated}
      />
    </>
  )
}
