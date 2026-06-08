/**
 * Equality helpers for the live session view's fallback polls (ticket #305).
 *
 * Both polls (agent list + listener status) re-fetch on a timer. Without an equality
 * guard each tick assigns a fresh array/object ref even when nothing changed, re-rendering
 * the agent list / page every 2 s. These pure comparators let the polls skip unchanged
 * commits. They live in their own module so the comparison fields are unit-tested and
 * stay in sync with future AgentInstance / ListenerStatus additions.
 */
import type { AgentInstance, ListenerStatus } from './api-types'

// Shallow structural compare of the fields the AgentSidebar renders. agentConfig is
// rendered as JSON.stringify (AgentSidebar) so we compare it the same way — an agent can
// be reconfigured in place without a status/podName change, and we still want that picked
// up. createdAt is keyed to id, so it needs no separate compare.
export function areAgentListsEqual(a: AgentInstance[], b: AgentInstance[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (
      x.id !== y.id ||
      x.status !== y.status ||
      x.podName !== y.podName ||
      x.name !== y.name ||
      x.icon !== y.icon ||
      x.stoppedAt !== y.stoppedAt ||
      JSON.stringify(x.agentConfig) !== JSON.stringify(y.agentConfig)
    ) {
      return false
    }
  }
  return true
}

// Compare the fields that drive the recording indicator, so an unchanged listener-status
// poll doesn't create a new object ref and re-render the page every 2 s.
export function isSameListenerStatus(a: ListenerStatus | null, b: ListenerStatus): boolean {
  if (!a) return false
  return (
    a.sessionStatus === b.sessionStatus &&
    a.listener.isMonitoring === b.listener.isMonitoring &&
    a.listener.isConnected === b.listener.isConnected &&
    a.listener.roomState === b.listener.roomState &&
    a.listener.participantIdentity === b.listener.participantIdentity &&
    a.listener.reconnectAttempts === b.listener.reconnectAttempts &&
    a.listener.remoteParticipants === b.listener.remoteParticipants
  )
}
