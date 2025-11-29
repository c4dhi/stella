import { Injectable, Logger, OnModuleDestroy, forwardRef, Inject } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { AgentServerService } from './agent-server.service';
import { SessionsService } from '../sessions/sessions.service';
import {
  AgentOutput,
  ActiveOrchestratedSession,
  OutputType,
  ConversationTurn,
} from './agent.types';

/**
 * SessionOrchestratorService - Coordinates the full communication flow.
 *
 * Flow: User Audio → STT → Agent → TTS → User Audio
 *
 * This service:
 * - Starts orchestration when a user joins a session
 * - Routes STT transcripts to the agent
 * - Receives agent outputs and routes to TTS/frontend
 * - Handles barge-in (user interrupts agent)
 * - Manages text buffering for sentence-based TTS
 */
@Injectable()
export class SessionOrchestratorService implements OnModuleDestroy {
  private readonly logger = new Logger(SessionOrchestratorService.name);
  private activeSessions = new Map<string, ActiveOrchestratedSession>();

  constructor(
    private readonly agentServer: AgentServerService,
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
    @Inject(forwardRef(() => SessionsService))
    private readonly sessionsService: SessionsService,
  ) {}

  /**
   * Start orchestration for a session.
   * Called when a user joins a LiveKit room.
   */
  async startOrchestration(sessionId: string, roomName: string, agentName?: string, agentType?: string): Promise<void> {
    if (this.activeSessions.has(sessionId)) {
      this.logger.warn(`Orchestration already active for session ${sessionId}`);
      return;
    }

    this.logger.log(`Starting orchestration for session ${sessionId} in room ${roomName}`);

    const session: ActiveOrchestratedSession = {
      sessionId,
      roomName,
      textBuffer: '',
      isProcessing: false,
      agentConnected: false,
    };

    this.activeSessions.set(sessionId, session);

    // Wait for agent connection (with timeout)
    try {
      const agentStream = await this.agentServer.waitForAgentConnection(sessionId, 30000);
      session.agentConnected = true;

      // Subscribe to agent outputs
      agentStream.onOutput((output) => {
        this.handleAgentOutput(sessionId, output);
      });

      // Send session start to agent
      const config = await this.getSessionConfig(sessionId);
      await this.agentServer.sendSessionStart(sessionId, config);

      this.logger.log(`Agent connected and session started for ${sessionId}`);

      // Emit agent.ready event via SSE
      this.sessionsService.emitAgentReady(
        sessionId,
        sessionId, // Using sessionId as agentId for now
        agentName || 'Agent',
        agentType,
      );
    } catch (error) {
      this.logger.error(`Failed to connect agent for session ${sessionId}: ${error.message}`);

      // Emit agent.failed event via SSE
      this.sessionsService.emitAgentFailed(
        sessionId,
        sessionId,
        agentName || 'Agent',
        error.message,
      );

      this.activeSessions.delete(sessionId);
      throw error;
    }
  }

  /**
   * Stop orchestration for a session.
   * Called when all users leave the LiveKit room.
   */
  async stopOrchestration(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return;
    }

    this.logger.log(`Stopping orchestration for session ${sessionId}`);

    // Send session end to agent
    try {
      await this.agentServer.sendSessionEnd(sessionId);
    } catch (error) {
      this.logger.error(`Error sending session end: ${error.message}`);
    }

    this.activeSessions.delete(sessionId);
  }

  /**
   * Handle final STT transcript - send to agent.
   */
  async handleFinalTranscript(sessionId: string, text: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      this.logger.warn(`No active session for transcript: ${sessionId}`);
      return;
    }

    if (!session.agentConnected) {
      this.logger.warn(`Agent not connected for session: ${sessionId}`);
      return;
    }

    this.logger.log(`Processing transcript for ${sessionId}: ${text.substring(0, 50)}...`);

    session.isProcessing = true;

    // Get conversation history
    const history = await this.getConversationHistory(sessionId);

    // Store user message
    await this.storeMessage(sessionId, {
      content: text,
      role: 'user',
      messageType: 'transcript',
      status: 'final',
    });

    // Send to agent
    try {
      await this.agentServer.sendTextInput(sessionId, text, history);
    } catch (error) {
      this.logger.error(`Error sending text to agent: ${error.message}`);
      session.isProcessing = false;
    }
  }

  /**
   * Handle partial STT transcript - send to frontend for display.
   */
  async handlePartialTranscript(sessionId: string, text: string): Promise<void> {
    // Emit event for frontend display
    this.eventEmitter.emit('orchestrator.transcript.partial', {
      sessionId,
      text,
    });
  }

  /**
   * Handle user barge-in - interrupt agent and stop TTS.
   */
  async handleBargeIn(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session?.isProcessing) {
      return;
    }

    this.logger.log(`Barge-in detected for session ${sessionId}`);

    // Send interrupt to agent
    await this.agentServer.sendInterrupt(sessionId, 'user_barge_in');

    // Emit event to stop TTS playback
    this.eventEmitter.emit('orchestrator.tts.stop', { sessionId });

    // Clear text buffer
    session.textBuffer = '';
    session.isProcessing = false;
  }

  /**
   * Handle output from agent.
   */
  private async handleAgentOutput(sessionId: string, output: AgentOutput): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return;
    }

    switch (output.type) {
      case OutputType.TEXT_CHUNK:
        await this.handleTextChunk(sessionId, output);
        break;

      case OutputType.TEXT_FINAL:
        await this.handleTextFinal(sessionId, output);
        break;

      case OutputType.STATUS:
        await this.handleStatus(sessionId, output);
        break;

      case OutputType.METADATA:
        await this.handleMetadata(sessionId, output);
        break;

      case OutputType.ERROR:
        await this.handleError(sessionId, output);
        break;

      default:
        this.logger.debug(`Unknown output type: ${output.type}`);
    }
  }

  /**
   * Handle text chunk from agent - buffer and send to frontend.
   */
  private async handleTextChunk(sessionId: string, output: AgentOutput): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    // Buffer text for TTS
    session.textBuffer += output.content;

    // Send to frontend for immediate display
    this.eventEmitter.emit('orchestrator.text.chunk', {
      sessionId,
      content: output.content,
      transcriptId: output.transcriptId,
    });

    // Check for sentence end - trigger TTS
    if (this.isSentenceEnd(session.textBuffer)) {
      const sentenceText = session.textBuffer.trim();
      session.textBuffer = '';

      // Emit for TTS synthesis
      this.eventEmitter.emit('orchestrator.tts.synthesize', {
        sessionId,
        text: sentenceText,
      });
    }

    // If this is the final chunk, process any remaining buffer
    if (output.isFinal && session.textBuffer.length > 0) {
      const remainingText = session.textBuffer.trim();
      session.textBuffer = '';

      if (remainingText.length > 0) {
        this.eventEmitter.emit('orchestrator.tts.synthesize', {
          sessionId,
          text: remainingText,
        });
      }

      session.isProcessing = false;

      // Store complete assistant response
      await this.storeMessage(sessionId, {
        content: output.content,
        role: 'assistant',
        messageType: 'transcript',
        status: 'final',
        metadata: { transcriptId: output.transcriptId },
      });
    }
  }

  /**
   * Handle final text from agent - synthesize immediately.
   */
  private async handleTextFinal(sessionId: string, output: AgentOutput): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) return;

    // Send to frontend
    this.eventEmitter.emit('orchestrator.text.final', {
      sessionId,
      content: output.content,
    });

    // Clear buffer and add final content
    session.textBuffer = '';
    session.isProcessing = false;

    // Synthesize the final text
    this.eventEmitter.emit('orchestrator.tts.synthesize', {
      sessionId,
      text: output.content,
    });

    // Store message
    await this.storeMessage(sessionId, {
      content: output.content,
      role: 'assistant',
      messageType: 'transcript',
      status: 'final',
    });
  }

  /**
   * Handle status update from agent - send to frontend (no TTS).
   */
  private async handleStatus(sessionId: string, output: AgentOutput): Promise<void> {
    this.eventEmitter.emit('orchestrator.status', {
      sessionId,
      content: output.content,
      subtype: output.statusSubtype,
      metadata: output.metadata,
    });

    // Store status message
    await this.storeMessage(sessionId, {
      content: output.content,
      role: 'system',
      messageType: 'system',
      metadata: {
        statusSubtype: output.statusSubtype,
        ...output.metadata,
      },
    });
  }

  /**
   * Handle metadata update from agent.
   */
  private async handleMetadata(sessionId: string, output: AgentOutput): Promise<void> {
    this.eventEmitter.emit('orchestrator.metadata', {
      sessionId,
      content: output.content,
      subtype: output.metadataSubtype,
      metadata: output.metadata,
    });
  }

  /**
   * Handle error from agent.
   */
  private async handleError(sessionId: string, output: AgentOutput): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      session.isProcessing = false;
    }

    this.logger.error(`Agent error for session ${sessionId}: ${output.content}`);

    this.eventEmitter.emit('orchestrator.error', {
      sessionId,
      content: output.content,
      metadata: output.metadata,
    });
  }

  /**
   * Check if text ends with sentence-ending punctuation.
   */
  private isSentenceEnd(text: string): boolean {
    return /[.!?]\s*$/.test(text);
  }

  /**
   * Get conversation history for context.
   */
  private async getConversationHistory(sessionId: string): Promise<ConversationTurn[]> {
    const messages = await this.prisma.message.findMany({
      where: {
        sessionId,
        messageType: 'transcript',
        status: 'final',
      },
      orderBy: { timestamp: 'desc' },
      take: 20, // Last 20 messages
    });

    return messages.reverse().map((msg) => ({
      role: msg.role || 'user',
      content: msg.content,
    }));
  }

  /**
   * Get session configuration for agent.
   */
  private async getSessionConfig(sessionId: string): Promise<Record<string, string>> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: {
        room: true,
        project: true,
      },
    });

    if (!session) {
      return {};
    }

    return {
      sessionId: session.id,
      projectId: session.projectId,
      projectName: session.project.name,
      roomName: session.room?.livekitRoomName || '',
    };
  }

  /**
   * Store a message in the database.
   */
  private async storeMessage(
    sessionId: string,
    data: {
      content: string;
      role: string;
      messageType: string;
      status?: string;
      metadata?: Record<string, any>;
    },
  ): Promise<void> {
    try {
      await this.prisma.message.create({
        data: {
          sessionId,
          content: data.content,
          role: data.role,
          messageType: data.messageType,
          status: data.status,
          metadata: data.metadata,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to store message: ${error.message}`);
    }
  }

  /**
   * Check if orchestration is active for a session.
   */
  isActive(sessionId: string): boolean {
    return this.activeSessions.has(sessionId);
  }

  /**
   * Check if agent is processing for a session.
   */
  isProcessing(sessionId: string): boolean {
    return this.activeSessions.get(sessionId)?.isProcessing ?? false;
  }

  /**
   * Listen for agent output events (from AgentServerService).
   */
  @OnEvent('agent.output.*')
  handleAgentOutputEvent(payload: any): void {
    const sessionId = payload.sessionId;
    if (this.activeSessions.has(sessionId)) {
      this.handleAgentOutput(sessionId, payload);
    }
  }

  /**
   * Cleanup on module destroy.
   */
  onModuleDestroy(): void {
    for (const [sessionId] of this.activeSessions) {
      this.stopOrchestration(sessionId);
    }
  }
}
