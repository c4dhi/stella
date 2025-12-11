import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Users, X, Trash2, Crown, Clock, UserPlus } from 'lucide-react'
import { useThemeStore } from '../../store/themeStore'
import { useToastStore } from '../../store/toastStore'
import { apiClient } from '../../services/ApiClient'
import type { Collaborator, PendingProjectInvitation } from '../../lib/api-types'

// Combined type for displaying both collaborators and pending invitations
type DisplayMember = {
  id: string // Either userId or invitationId
  email: string
  name: string | null
  role: 'OWNER' | 'COLLABORATOR' | 'PENDING'
  isPending: boolean
}

interface ShareProjectModalProps {
  isOpen: boolean
  onClose: () => void
  projectId: string
  projectName: string
  isOwner: boolean
}

export default function ShareProjectModal({
  isOpen,
  onClose,
  projectId,
  projectName,
  isOwner,
}: ShareProjectModalProps) {
  const { resolvedTheme } = useThemeStore()
  const { addToast } = useToastStore()
  const isDark = resolvedTheme === 'dark'

  const [collaborators, setCollaborators] = useState<Collaborator[]>([])
  const [pendingInvitations, setPendingInvitations] = useState<PendingProjectInvitation[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [email, setEmail] = useState('')
  const [inviteLoading, setInviteLoading] = useState(false)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [removingIds, setRemovingIds] = useState<Set<string>>(new Set())

  // Fetch collaborators when modal opens
  useEffect(() => {
    if (isOpen) {
      loadCollaborators()
    }
  }, [isOpen, projectId])

  const loadCollaborators = async () => {
    try {
      setIsLoading(true)
      const response = await apiClient.getProjectCollaborators(projectId)
      setCollaborators(response.collaborators)
      setPendingInvitations(response.pendingInvitations)
    } catch (err: any) {
      addToast({
        message: err.message || 'Failed to load collaborators',
        type: 'error',
      })
    } finally {
      setIsLoading(false)
    }
  }

  // Combine collaborators and pending invitations for display
  const displayMembers: DisplayMember[] = [
    ...collaborators.map((c) => ({
      id: c.userId,
      email: c.email,
      name: c.name,
      role: c.role as 'OWNER' | 'COLLABORATOR',
      isPending: false,
    })),
    ...pendingInvitations.map((p) => ({
      id: p.invitationId,
      email: p.email,
      name: p.name,
      role: 'PENDING' as const,
      isPending: true,
    })),
  ]

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!email.trim()) {
      setInviteError('Please enter an email address')
      return
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      setInviteError('Please enter a valid email address')
      return
    }

    setInviteLoading(true)
    setInviteError(null)

    try {
      await apiClient.inviteCollaborator(projectId, email)
      setEmail('')
      addToast({
        message: `Invitation sent to ${email}`,
        type: 'success',
      })
      // Reload to show pending invitation
      await loadCollaborators()
    } catch (err: any) {
      setInviteError(err.message || 'Failed to send invitation')
    } finally {
      setInviteLoading(false)
    }
  }

  const handleRemoveMember = async (member: DisplayMember) => {
    setRemovingIds((prev) => new Set(prev).add(member.id))
    try {
      if (member.isPending) {
        // Cancel pending invitation
        await apiClient.cancelProjectInvitation(member.id)
        setPendingInvitations((prev) => prev.filter((p) => p.invitationId !== member.id))
        addToast({
          message: `Invitation to ${member.name || member.email} cancelled`,
          type: 'info',
        })
      } else {
        // Remove collaborator
        await apiClient.removeCollaborator(projectId, member.id)
        setCollaborators((prev) => prev.filter((c) => c.userId !== member.id))
        addToast({
          message: `${member.name || member.email} removed from project`,
          type: 'info',
        })
      }
    } catch (err: any) {
      addToast({
        message: err.message || 'Failed to remove',
        type: 'error',
      })
    } finally {
      setRemovingIds((prev) => {
        const next = new Set(prev)
        next.delete(member.id)
        return next
      })
    }
  }

  const handleClose = () => {
    setEmail('')
    setInviteError(null)
    onClose()
  }

  const getInitials = (name: string | null, email: string) => {
    const displayName = name || email.split('@')[0]
    return displayName
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  const getRoleBadge = (role: 'OWNER' | 'COLLABORATOR' | 'PENDING') => {
    switch (role) {
      case 'OWNER':
        return (
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-caption font-medium ${
              isDark ? 'bg-amber-500/20 text-amber-400' : 'bg-amber-100 text-amber-700'
            }`}
          >
            <Crown className="w-3 h-3" />
            Owner
          </span>
        )
      case 'PENDING':
        return (
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-caption font-medium ${
              isDark ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-100 text-blue-700'
            }`}
          >
            <Clock className="w-3 h-3" />
            Pending
          </span>
        )
      default:
        return (
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-caption font-medium ${
              isDark ? 'bg-green-500/20 text-green-400' : 'bg-green-100 text-green-700'
            }`}
          >
            <Users className="w-3 h-3" />
            Collaborator
          </span>
        )
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          onClick={handleClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className={`card-elevated w-full max-w-lg p-6 max-h-[80vh] flex flex-col ${
              isDark ? 'bg-surface-dark-secondary' : ''
            }`}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="mb-6 relative flex-shrink-0">
              <button
                onClick={handleClose}
                className={`absolute -top-1 -right-1 p-2 rounded-lg transition-colors ${
                  isDark
                    ? 'text-content-inverse-tertiary hover:text-content-inverse hover:bg-surface-dark-tertiary'
                    : 'text-content-tertiary hover:text-content hover:bg-surface-secondary'
                }`}
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
              <div className="flex items-center gap-3">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                    isDark ? 'bg-primary/20 text-primary' : 'bg-primary/10 text-primary'
                  }`}
                >
                  <Users className="w-5 h-5" />
                </div>
                <div>
                  <h2 className={`text-heading-lg ${isDark ? 'text-content-inverse' : 'text-content'}`}>
                    Share Project
                  </h2>
                  <p
                    className={`text-body-sm ${isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'}`}
                  >
                    {projectName}
                  </p>
                </div>
              </div>
            </div>

            {/* Invite Form - Only for owners */}
            {isOwner && (
              <form onSubmit={handleInvite} className="mb-6 flex-shrink-0">
                <label
                  className={`block text-label uppercase mb-2 ${
                    isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'
                  }`}
                >
                  Invite by Email
                </label>
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value)
                      setInviteError(null)
                    }}
                    className="input-field flex-1"
                    placeholder="colleague@example.com"
                    disabled={inviteLoading}
                  />
                  <button
                    type="submit"
                    disabled={inviteLoading || !email.trim()}
                    className="btn-primary px-4 flex items-center gap-2"
                  >
                    <UserPlus className="w-4 h-4" />
                    {inviteLoading ? 'Sending...' : 'Invite'}
                  </button>
                </div>
                {inviteError && (
                  <motion.p
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`mt-2 text-body-sm ${isDark ? 'text-red-400' : 'text-red-600'}`}
                  >
                    {inviteError}
                  </motion.p>
                )}
              </form>
            )}

            {/* Collaborators List */}
            <div className="flex-1 overflow-y-auto min-h-0">
              <h3
                className={`text-label uppercase mb-3 ${
                  isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'
                }`}
              >
                People with access ({displayMembers.length})
              </h3>

              {isLoading ? (
                <div
                  className={`text-center py-8 text-body-sm ${
                    isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'
                  }`}
                >
                  Loading collaborators...
                </div>
              ) : displayMembers.length === 0 ? (
                <div
                  className={`text-center py-8 text-body-sm ${
                    isDark ? 'text-content-inverse-secondary' : 'text-content-secondary'
                  }`}
                >
                  No collaborators yet
                </div>
              ) : (
                <div className="space-y-2">
                  {displayMembers.map((member) => {
                    const isRemoving = removingIds.has(member.id)
                    const canRemove = isOwner && member.role !== 'OWNER'

                    return (
                      <motion.div
                        key={member.id}
                        layout
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: 10 }}
                        className={`flex items-center gap-3 p-3 rounded-xl ${
                          isDark ? 'bg-surface-dark-tertiary' : 'bg-surface-secondary'
                        } ${isRemoving ? 'opacity-50' : ''}`}
                      >
                        {/* Avatar */}
                        <div
                          className={`w-9 h-9 rounded-full flex items-center justify-center text-body-sm font-medium flex-shrink-0 ${
                            member.isPending
                              ? isDark ? 'bg-blue-500/20 text-blue-400' : 'bg-blue-100 text-blue-700'
                              : isDark ? 'bg-primary/20 text-primary' : 'bg-primary/10 text-primary'
                          }`}
                        >
                          {getInitials(member.name, member.email)}
                        </div>

                        {/* Info */}
                        <div className="flex-1 min-w-0">
                          <div
                            className={`text-body-sm font-medium truncate ${
                              isDark ? 'text-content-inverse' : 'text-content'
                            }`}
                          >
                            {member.name || member.email.split('@')[0]}
                          </div>
                          <div
                            className={`text-caption truncate ${
                              isDark ? 'text-content-inverse-tertiary' : 'text-content-tertiary'
                            }`}
                          >
                            {member.email}
                          </div>
                        </div>

                        {/* Role Badge */}
                        <div className="flex-shrink-0">{getRoleBadge(member.role)}</div>

                        {/* Remove Button */}
                        {canRemove && (
                          <button
                            onClick={() => handleRemoveMember(member)}
                            disabled={isRemoving}
                            className={`p-2 rounded-lg transition-colors flex-shrink-0 ${
                              isDark
                                ? 'text-content-inverse-tertiary hover:text-red-400 hover:bg-red-500/20'
                                : 'text-content-tertiary hover:text-red-600 hover:bg-red-50'
                            }`}
                            title={member.isPending ? 'Cancel invitation' : 'Remove from project'}
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </motion.div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="mt-6 pt-4 border-t flex-shrink-0 border-border dark:border-border-dark">
              <button onClick={handleClose} className="btn-secondary w-full">
                Done
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
