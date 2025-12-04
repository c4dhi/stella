/**
 * TranscriptProcessor Interface
 *
 * This is the key extension point for the voice AI pipeline.
 * When a final transcript is received from STT, it flows through the
 * TranscriptProcessor before being sent to TTS.
 *
 * Current implementation: PassthroughProcessor (narrates input directly)
 * Future implementation: AgentProcessor (processes with Agent SDK, narrates response)
 *
 * To swap implementations:
 * 1. Create new processor implementing this interface
 * 2. Change `useClass` in TranscriptProcessorModule
 * 3. Or use factory provider with env var for config-driven selection
 */

export interface TranscriptProcessorResult {
  /** The text to be synthesized by TTS */
  text: string;

  /** Whether to send this text to TTS (false = silent processing) */
  shouldSpeak: boolean;

  /** Optional metadata for logging/debugging */
  metadata?: Record<string, any>;
}

export interface TranscriptProcessor {
  /**
   * Process a final transcript and return text for TTS.
   *
   * @param transcript - The final transcript from STT
   * @param sessionId - The session identifier
   * @param participantId - The participant who spoke
   * @returns Result containing text for TTS and whether to speak
   */
  process(
    transcript: string,
    sessionId: string,
    participantId: string,
  ): Promise<TranscriptProcessorResult>;
}

/**
 * Injection token for the TranscriptProcessor.
 * Use @Inject(TRANSCRIPT_PROCESSOR) to inject the active processor.
 */
export const TRANSCRIPT_PROCESSOR = Symbol('TRANSCRIPT_PROCESSOR');
