import {
  Injectable,
  Logger,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Room,
  RoomEvent,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
  TrackKind,
  AudioStream,
} from '@livekit/rtc-node';
import { LiveKitService } from '../livekit/livekit.service';
import {
  STTClientService,
  STTStream,
  TranscriptEvent,
} from '../stt-client/stt-client.service';
import * as crypto from 'crypto';

interface ActiveSession {
  room: Room;
  sttStreams: Map<string, STTStream>; // participantIdentity -> STTStream
  audioStreams: Map<string, AudioStream>; // participantIdentity -> AudioStream
}

@Injectable()
export class RoomAgentService implements OnModuleDestroy {
  private readonly logger = new Logger(RoomAgentService.name);
  private activeSessions: Map<string, ActiveSession> = new Map();

  constructor(
    private livekitService: LiveKitService,
    private sttClient: STTClientService,
    private configService: ConfigService,
  ) {}

  async onModuleDestroy() {
    // Clean up all rooms on shutdown
    for (const [sessionId] of this.activeSessions) {
      await this.leaveRoom(sessionId);
    }
  }

  /**
   * Join a LiveKit room as the "agent" participant.
   */
  async joinRoom(
    roomName: string,
    sessionId: string,
    agentName: string = 'Grace AI',
  ): Promise<void> {
    if (this.activeSessions.has(sessionId)) {
      this.logger.warn(`Already in room for session ${sessionId}`);
      return;
    }

    const agentIdentity = `agent-${sessionId.slice(0, 8)}`;

    // Generate agent token
    const token = await this.livekitService.createToken(
      roomName,
      agentIdentity,
      agentName,
    );

    const room = new Room();

    const session: ActiveSession = {
      room,
      sttStreams: new Map(),
      audioStreams: new Map(),
    };

    // Set up event handlers
    room.on(RoomEvent.Connected, () => {
      this.logger.log(
        `Agent connected to room ${roomName} for session ${sessionId}`,
      );
    });

    room.on(RoomEvent.Disconnected, () => {
      this.logger.log(`Agent disconnected from room ${roomName}`);
      this.cleanupSession(sessionId);
    });

    room.on(
      RoomEvent.TrackSubscribed,
      (
        track: RemoteTrack,
        publication: RemoteTrackPublication,
        participant: RemoteParticipant,
      ) => {
        // Only handle audio tracks from non-agent participants
        if (
          track.kind === TrackKind.KIND_AUDIO &&
          !participant.identity.startsWith('agent-')
        ) {
          this.logger.log(
            `Subscribed to audio track from ${participant.identity} (${participant.name})`,
          );
          this.handleAudioTrack(track, participant, sessionId, session);
        }
      },
    );

    room.on(
      RoomEvent.TrackUnsubscribed,
      (
        track: RemoteTrack,
        publication: RemoteTrackPublication,
        participant: RemoteParticipant,
      ) => {
        // track can be undefined in some cases
        if (track && track.kind === TrackKind.KIND_AUDIO) {
          this.logger.log(
            `Unsubscribed from audio track from ${participant.identity}`,
          );
          this.cleanupParticipantStreams(session, participant.identity);
        }
      },
    );

    room.on(RoomEvent.ParticipantConnected, (participant: RemoteParticipant) => {
      this.logger.log(
        `Participant ${participant.identity} (${participant.name}) connected to session ${sessionId}`,
      );
    });

    room.on(
      RoomEvent.ParticipantDisconnected,
      (participant: RemoteParticipant) => {
        this.logger.log(
          `Participant ${participant.identity} disconnected from session ${sessionId}`,
        );
        this.cleanupParticipantStreams(session, participant.identity);
      },
    );

    // Store session before connecting
    this.activeSessions.set(sessionId, session);

    // Connect to room
    const livekitUrl = this.livekitService.getServerUrl();
    this.logger.log(`Connecting agent to ${livekitUrl} room ${roomName}`);

    try {
      await room.connect(livekitUrl, token);
      this.logger.log(
        `Agent successfully joined room ${roomName} as ${agentIdentity}`,
      );
    } catch (error) {
      this.activeSessions.delete(sessionId);
      throw error;
    }
  }

  /**
   * Handle an audio track from a participant.
   */
  private async handleAudioTrack(
    track: RemoteTrack,
    participant: RemoteParticipant,
    sessionId: string,
    session: ActiveSession,
  ): Promise<void> {
    const participantId = participant.name || participant.identity;

    try {
      // Create audio stream (16kHz mono for STT)
      const audioStream = new AudioStream(track, 16000, 1);
      session.audioStreams.set(participant.identity, audioStream);

      // Create STT stream
      const sttStream = this.sttClient.createStream(sessionId, participantId);
      session.sttStreams.set(participant.identity, sttStream);

      // Handle incoming transcripts
      sttStream.on('data', (event: TranscriptEvent) => {
        this.publishTranscript(session.room, event, participantId);
      });

      sttStream.on('error', (err: Error) => {
        this.logger.error(
          `STT stream error for ${participant.identity}: ${err.message}`,
        );
      });

      sttStream.on('end', () => {
        this.logger.log(`STT stream ended for ${participant.identity}`);
      });

      // Forward audio chunks to STT
      this.processAudioStream(
        audioStream,
        sttStream,
        sessionId,
        participantId,
      );
    } catch (error) {
      this.logger.error(`Error handling audio track: ${error.message}`);
    }
  }

  /**
   * Process audio stream and forward to STT.
   */
  private async processAudioStream(
    audioStream: AudioStream,
    sttStream: STTStream,
    sessionId: string,
    participantId: string,
  ): Promise<void> {
    try {
      for await (const frame of audioStream) {
        // Check if session is still active
        if (!this.activeSessions.has(sessionId)) {
          break;
        }

        // Convert AudioFrame to Buffer
        // frame.data is Int16Array, convert to Buffer
        const audioBuffer = Buffer.from(frame.data.buffer);

        // Send to STT service
        sttStream.write({
          audioData: audioBuffer,
          sessionId,
          participantId,
          timestampMs: Date.now(),
        });
      }
    } catch (error) {
      if (error.message !== 'Iterator closed') {
        this.logger.error(`Audio stream processing error: ${error.message}`);
      }
    } finally {
      sttStream.end();
    }
  }

  /**
   * Publish a transcript event to the room via data channel.
   */
  private async publishTranscript(
    room: Room,
    event: TranscriptEvent,
    participantName: string,
  ): Promise<void> {
    // Format message as expected by frontend
    const message = {
      type: 'transcript_chunk',
      data: {
        text: event.text,
        is_final: event.isFinal,
        transcript_id: event.transcriptId,
        participant_id: participantName,
        confidence: event.confidence,
        timestamp: new Date().toISOString(),
        chunk_id: `ts_${crypto.randomBytes(4).toString('hex')}`,
      },
    };

    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(JSON.stringify(message));

      if (!room.localParticipant) {
        this.logger.warn('Cannot publish transcript: localParticipant not available');
        return;
      }

      await room.localParticipant.publishData(data, {
        reliable: true,
        topic: 'transcript',
      });

      if (event.isFinal) {
        this.logger.log(
          `Published final transcript: "${event.text}" from ${participantName}`,
        );
      }
    } catch (error) {
      this.logger.error(`Failed to publish transcript: ${error.message}`);
    }
  }

  /**
   * Leave a room and cleanup resources.
   */
  async leaveRoom(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return;
    }

    this.logger.log(`Leaving room for session ${sessionId}`);

    // Cleanup all streams
    for (const [identity] of session.sttStreams) {
      this.cleanupParticipantStreams(session, identity);
    }

    // Disconnect from room
    try {
      await session.room.disconnect();
    } catch (error) {
      this.logger.error(`Error disconnecting from room: ${error.message}`);
    }

    this.activeSessions.delete(sessionId);
    this.logger.log(`Successfully left room for session ${sessionId}`);
  }

  /**
   * Cleanup streams for a specific participant.
   */
  private cleanupParticipantStreams(
    session: ActiveSession,
    participantIdentity: string,
  ): void {
    const sttStream = session.sttStreams.get(participantIdentity);
    if (sttStream) {
      sttStream.end();
      session.sttStreams.delete(participantIdentity);
    }

    session.audioStreams.delete(participantIdentity);
  }

  /**
   * Cleanup entire session.
   */
  private cleanupSession(sessionId: string): void {
    this.activeSessions.delete(sessionId);
  }

  /**
   * Check if agent is currently in a room for a session.
   */
  isInRoom(sessionId: string): boolean {
    return this.activeSessions.has(sessionId);
  }
}
