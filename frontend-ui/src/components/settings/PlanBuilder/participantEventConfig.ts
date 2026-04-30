import type { ParticipantEventMessageConfig } from '../../../lib/api-types'

export const DEFAULT_JOIN_MESSAGE = ''
export const DEFAULT_LEFT_MESSAGE = ''

export const JOIN_MESSAGE_PLACEHOLDER = "Hi! I'm {agent_name}, welcome!"
export const LEFT_MESSAGE_PLACEHOLDER = 'Goodbye, see you soon.'

export const PARTICIPANT_EVENT_TOKEN_OPTIONS = [
  { label: 'Participant Name', token: '{participant_name}' },
  { label: 'Agent Name', token: '{agent_name}' },
] as const

export const extractParticipantEventConfig = (
  raw: unknown,
  event: 'on_participant_join' | 'on_participant_left',
): ParticipantEventMessageConfig => {
  if (!raw || typeof raw !== 'object') {
    return {
      enabled: false,
      message_template: event === 'on_participant_join' ? DEFAULT_JOIN_MESSAGE : DEFAULT_LEFT_MESSAGE,
    }
  }

  const cfg = raw as ParticipantEventMessageConfig
  return {
    enabled: cfg.enabled === true,
    message_template:
      typeof cfg.message_template === 'string'
        ? cfg.message_template
        : event === 'on_participant_join'
          ? DEFAULT_JOIN_MESSAGE
          : DEFAULT_LEFT_MESSAGE,
  }
}
