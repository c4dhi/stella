/**
 * SpokenMessageText (#241)
 *
 * Renders a chat message's text, applying the word-by-word teleprompter
 * highlight when this message is the one currently being spoken (or one that a
 * barge-in froze mid-way). Shared by the organizer chat (`MessageBubble`) and
 * the participant chat (`ParticipantChatPanel`) so both surfaces highlight
 * identically. Non-agent messages and inactive bubbles render as plain text.
 */
import React from 'react'
import SpokenText from './SpokenText'

interface SpokenMessageTextProps {
  text: string
  /** This message's id (matched against the active/frozen transcript). */
  messageId: string
  /** Only agent/assistant messages receive the spoken highlight. */
  isAgent: boolean
  /** Live cursor + bindings from `useTeleprompter`. */
  spokenChar?: number
  spokenTranscriptId?: string
  frozenSpoken?: Record<string, number>
}

const SpokenMessageText: React.FC<SpokenMessageTextProps> = ({
  text,
  messageId,
  isAgent,
  spokenChar = 0,
  spokenTranscriptId,
  frozenSpoken,
}) => {
  if (isAgent && messageId === spokenTranscriptId) {
    return <SpokenText text={text} spokenChar={spokenChar} />
  }
  const frozen = isAgent ? frozenSpoken?.[messageId] : undefined
  if (frozen != null) {
    return <SpokenText text={text} spokenChar={frozen} />
  }
  return <>{text}</>
}

export default SpokenMessageText
