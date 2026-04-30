/**
 * Response DTOs for public project endpoints
 */

/**
 * Public project info returned when viewing /p/:publicToken
 * Does not include sensitive configuration details
 */
export class PublicProjectInfoDto {
  projectName: string;
  agentName: string;
  agentIcon?: string;
  visualizerType?: string;
  visualizerLocked: boolean;
  maxSessionDurationSeconds?: number;
  isExpired: boolean;
  isEnabled: boolean;
}

/**
 * Response after successfully joining a public project
 * Contains the invitation token for redirect to /join/:invitationToken
 */
export class JoinPublicProjectResponseDto {
  invitationToken: string;
  sessionId: string;
  agentId: string;
}

/**
 * Response after starting a public project join (non-blocking)
 * Returns immediately with sessionId
 * Frontend polls status then subscribes to SSE for updates
 */
export class StartJoinPublicProjectResponseDto {
  sessionId: string;
}

/**
 * Join progress status (for polling endpoint)
 */
export class JoinProgressDto {
  step: number;
  totalSteps: number;
  status: 'in_progress' | 'complete' | 'failed';
  message: string;
  agentId?: string;
  invitationToken?: string;
  error?: string;
}
