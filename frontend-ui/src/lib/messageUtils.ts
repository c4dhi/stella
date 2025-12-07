/**
 * Message utility functions for consistent message role determination.
 *
 * This module provides a single source of truth for determining how messages
 * should be displayed based on the viewer's identity.
 */

/**
 * Determines the display role for a message based on who's viewing it.
 * Works for ANY viewer (organizer or participant).
 *
 * @param speakerId - Identity of who sent the message (from metadata.speaker_id)
 * @param source - Message source: 'agent_response', 'user_text', 'user_speech'
 * @param messageType - Message type: 'agent_text', 'transcript', 'transcript_chunk', etc.
 * @param viewerIdentity - Identity of the current viewer ('human' for organizer, 'participant-xxx' for participants)
 * @param speakerName - Optional speaker name for fallback matching
 * @param viewerName - Optional viewer name for fallback matching
 * @returns 'user' if viewer sent it, 'assistant' if agent sent it, 'other_user' for other humans
 */
export function determineMessageRole(
  speakerId: string | undefined,
  source: string | undefined,
  messageType: string | undefined,
  viewerIdentity: string,
  speakerName?: string,
  viewerName?: string
): 'user' | 'assistant' | 'other_user' {
  // 1. Agent messages are always 'assistant'
  if (source === 'agent_response' || messageType === 'agent_text') {
    return 'assistant'
  }
  if (speakerId?.startsWith('agent-')) {
    return 'assistant'
  }

  // 2. Compare speaker identity to viewer identity
  if (speakerId && speakerId === viewerIdentity) {
    return 'user'  // "I sent this"
  }

  // 3. Fallback: Compare names (backwards compatibility)
  if (viewerName && speakerName && speakerName === viewerName) {
    return 'user'  // "I sent this" (name match fallback)
  }

  // 4. All other human messages are from "other users"
  return 'other_user'
}

/**
 * Extracts speaker identity from message metadata.
 * Handles various metadata formats for backwards compatibility.
 */
export function extractSpeakerInfo(metadata: Record<string, any> | null | undefined): {
  speakerId: string | undefined
  speakerName: string | undefined
} {
  if (!metadata) {
    return { speakerId: undefined, speakerName: undefined }
  }

  // Try various locations where speaker info might be stored
  const speakerId =
    metadata.speaker_id ||
    metadata.speakerId ||
    metadata.envelope?.data?.speaker_id ||
    metadata.envelope?.participant_id ||
    metadata.participant_identity

  const speakerName =
    metadata.speaker_name ||
    metadata.speakerName ||
    metadata.envelope?.data?.speaker_name ||
    metadata.display_name ||
    metadata.participant_name

  return { speakerId, speakerName }
}
