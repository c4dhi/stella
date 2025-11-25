import {
  Injectable,
  Logger,
  OnModuleDestroy,
  Inject,
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
  AudioSource,
  AudioFrame,
  LocalAudioTrack,
  TrackPublishOptions,
  TrackSource,
} from '@livekit/rtc-node';
import { LiveKitService } from '../livekit/livekit.service';
import {
  STTClientService,
  STTStream,
  TranscriptEvent,
} from '../stt-client/stt-client.service';
import { TTSClientService } from '../tts-client/tts-client.service';
import type { TranscriptProcessor } from '../transcript-processor/transcript-processor.interface';
import { TRANSCRIPT_PROCESSOR } from '../transcript-processor/transcript-processor.interface';
import * as crypto from 'crypto';

interface ActiveSession {
  room: Room;
  sttStreams: Map<string, STTStream>; // participantIdentity -> STTStream
  audioStreams: Map<string, AudioStream>; // participantIdentity -> AudioStream
  audioSource?: AudioSource; // For TTS audio output
  audioTrack?: LocalAudioTrack; // Published audio track
  isSpeaking: boolean; // Track if agent is currently speaking
}

@Injectable()
export class RoomAgentService implements OnModuleDestroy {
  private readonly logger = new Logger(RoomAgentService.name);
  private activeSessions: Map<string, ActiveSession> = new Map();

  constructor(
    private livekitService: LiveKitService,
    private sttClient: STTClientService,
    private ttsClient: TTSClientService,
    @Inject(TRANSCRIPT_PROCESSOR)
    private transcriptProcessor: TranscriptProcessor,
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
      isSpeaking: false,
    };

    // Set up event handlers
    room.on(RoomEvent.Connected, () => {
      this.logger.log(
        `Agent connected to room ${roomName} for session ${sessionId}`,
      );
      // Note: setupAudioPublishing is called directly after room.connect()
      // to ensure it runs reliably (event handler async issues)
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

    // Handle text messages from participants
    room.on(
      RoomEvent.DataReceived,
      (
        payload: Uint8Array,
        participant?: RemoteParticipant,
      ) => {
        // Ignore messages from agents
        if (participant?.identity?.startsWith('agent-')) {
          return;
        }

        try {
          const decoder = new TextDecoder();
          const messageText = decoder.decode(payload);
          const envelope = JSON.parse(messageText);

          if (envelope.type === 'user_text' && envelope.data) {
            const text =
              typeof envelope.data === 'string'
                ? envelope.data
                : envelope.data.text;

            if (text && text.trim().length > 0) {
              const participantId =
                participant?.name || participant?.identity || 'user';
              this.logger.log(
                `Received text message from ${participantId}: "${text}"`,
              );

              // Echo the text as a transcript for frontend display
              this.publishTextAsTranscript(
                session.room,
                text,
                participantId,
                sessionId,
              );

              // Process through TTS pipeline (same as final transcripts)
              this.handleFinalTranscript(session, sessionId, text, participantId).catch(
                (err) =>
                  this.logger.error(`Text message TTS error: ${err.message}`),
              );
            }
          }
        } catch (error) {
          // Non-JSON data or parse error - ignore silently
          this.logger.debug(`Non-JSON data received, ignoring`);
        }
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

      // Set up audio publishing immediately after connection
      // (don't rely on RoomEvent.Connected event which may not fire reliably with async handlers)
      await this.setupAudioPublishing(session, sessionId);
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
        this.publishTranscript(session.room, event, participantId, sessionId);
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
   * If it's a final transcript, also triggers TTS processing.
   */
  private async publishTranscript(
    room: Room,
    event: TranscriptEvent,
    participantName: string,
    sessionId: string,
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

        // Trigger TTS processing for final transcripts
        const session = this.activeSessions.get(sessionId);
        if (session && event.text.trim().length > 0) {
          // Process TTS in background (don't await to avoid blocking data channel)
          this.handleFinalTranscript(
            session,
            sessionId,
            event.text,
            participantName,
          ).catch((err) => {
            this.logger.error(`TTS background processing error: ${err.message}`);
          });
        }
      }
    } catch (error) {
      this.logger.error(`Failed to publish transcript: ${error.message}`);
    }
  }

  /**
   * Publish a text message as a final transcript (for echoing user text input).
   */
  private async publishTextAsTranscript(
    room: Room,
    text: string,
    participantName: string,
    sessionId: string,
  ): Promise<void> {
    const transcriptId = `txt_${crypto.randomBytes(4).toString('hex')}`;

    const message = {
      type: 'transcript_chunk',
      data: {
        text: text,
        is_final: true,
        transcript_id: transcriptId,
        participant_id: participantName,
        confidence: 1.0, // Text input has 100% confidence
        timestamp: new Date().toISOString(),
        chunk_id: `ts_${crypto.randomBytes(4).toString('hex')}`,
        source: 'text', // Indicate this came from text input
      },
    };

    try {
      const encoder = new TextEncoder();
      const data = encoder.encode(JSON.stringify(message));

      if (!room.localParticipant) {
        this.logger.warn(
          'Cannot publish text transcript: localParticipant not available',
        );
        return;
      }

      await room.localParticipant.publishData(data, {
        reliable: true,
        topic: 'transcript',
      });

      this.logger.log(
        `Published text as transcript: "${text}" from ${participantName}`,
      );
    } catch (error) {
      this.logger.error(`Failed to publish text transcript: ${error.message}`);
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

  /**
   * Set up audio publishing for TTS output.
   */
  private async setupAudioPublishing(
    session: ActiveSession,
    sessionId: string,
  ): Promise<void> {
    try {
      // Create audio source (24kHz mono for high-quality TTS output)
      session.audioSource = new AudioSource(24000, 1);

      // Create local audio track
      session.audioTrack = LocalAudioTrack.createAudioTrack(
        'agent-speech',
        session.audioSource,
      );

      // Publish the track with proper source type and DTX disabled for continuous audio
      if (session.room.localParticipant) {
        const options = new TrackPublishOptions();
        options.source = TrackSource.SOURCE_MICROPHONE;
        options.dtx = false; // Disable discontinuous transmission for smoother audio
        await session.room.localParticipant.publishTrack(session.audioTrack, options);
        this.logger.log(`Published agent audio track for session ${sessionId} (24kHz, DTX disabled)`);
      } else {
        this.logger.warn(
          `Cannot publish audio track: localParticipant not available`,
        );
      }
    } catch (error) {
      this.logger.error(`Failed to set up audio publishing: ${error.message}`);
    }
  }

  /**
   * Play audio buffer through the agent's audio track.
   * Audio buffer should be 16-bit PCM, 24kHz mono.
   */
  private async playAudio(
    session: ActiveSession,
    sessionId: string,
    audioBuffer: Buffer,
  ): Promise<void> {
    if (!session.audioSource) {
      this.logger.warn('Cannot play audio: audioSource not initialized');
      return;
    }

    try {
      session.isSpeaking = true;

      // Convert Buffer to Int16Array
      const samples = new Int16Array(
        audioBuffer.buffer,
        audioBuffer.byteOffset,
        audioBuffer.length / 2,
      );

      // Debug: Log audio buffer info
      const maxSample = Math.max(...Array.from(samples).map(Math.abs));
      const sampleRate = 24000;
      const durationSec = samples.length / sampleRate;
      this.logger.debug(
        `[AUDIO] Buffer: ${audioBuffer.length} bytes, ${samples.length} samples, ` +
          `${durationSec.toFixed(2)}s duration, max amplitude: ${maxSample}`,
      );

      // Stream in chunks for smooth playback
      // 720 samples = 30ms at 24kHz (higher quality than 480 @ 16kHz)
      const chunkSize = 720;
      const frameDurationMs = 30;
      const totalChunks = Math.ceil(samples.length / chunkSize);

      this.logger.debug(
        `[AUDIO] Publishing ${totalChunks} frames via LiveKit AudioSource (24kHz, 30ms frames)`,
      );

      // Use real-time pacing based on actual elapsed time
      const playbackStartTime = Date.now();

      for (let i = 0; i < samples.length; i += chunkSize) {
        // Check if session is still active
        if (!this.activeSessions.has(sessionId)) {
          this.logger.warn('[AUDIO] Session ended, stopping playback');
          break;
        }

        const chunkIndex = Math.floor(i / chunkSize);
        const end = Math.min(i + chunkSize, samples.length);
        const chunkSamples = samples.slice(i, end);
        const isLastChunk = end >= samples.length;

        // Handle frame data - pad last chunk with fade-out to avoid clicks
        let frameData: Int16Array;
        if (chunkSamples.length < chunkSize) {
          frameData = new Int16Array(chunkSize);
          frameData.set(chunkSamples);

          // Apply fade-out on the last frame to avoid audio clicks
          const fadeLength = Math.min(chunkSamples.length, 240); // ~10ms fade at 24kHz
          for (let j = 0; j < fadeLength; j++) {
            const fadeMultiplier = 1 - (j / fadeLength);
            const sampleIndex = chunkSamples.length - fadeLength + j;
            if (sampleIndex >= 0 && sampleIndex < chunkSamples.length) {
              frameData[sampleIndex] = Math.round(frameData[sampleIndex] * fadeMultiplier);
            }
          }
        } else if (isLastChunk) {
          // Apply fade-out to last full chunk as well
          frameData = new Int16Array(chunkSamples);
          const fadeLength = 240; // ~10ms fade at 24kHz
          for (let j = 0; j < fadeLength; j++) {
            const fadeMultiplier = 1 - (j / fadeLength);
            const sampleIndex = frameData.length - fadeLength + j;
            frameData[sampleIndex] = Math.round(frameData[sampleIndex] * fadeMultiplier);
          }
        } else {
          frameData = chunkSamples;
        }

        // Create and send audio frame
        const frame = new AudioFrame(
          frameData,
          sampleRate, // 24kHz
          1, // channels
          frameData.length, // samplesPerChannel
        );

        // Log first frame details
        if (chunkIndex === 0) {
          const frameMax = Math.max(...Array.from(frameData).map(Math.abs));
          this.logger.debug(
            `[AUDIO] First frame: ${frameData.length} samples, max amplitude: ${frameMax}`,
          );
        }

        await session.audioSource.captureFrame(frame);

        // Real-time pacing: calculate how long we should have elapsed by now
        // and sleep only the remaining time
        const expectedElapsedMs = (chunkIndex + 1) * frameDurationMs;
        const actualElapsedMs = Date.now() - playbackStartTime;
        const sleepTime = expectedElapsedMs - actualElapsedMs;

        if (sleepTime > 0) {
          await this.sleep(sleepTime);
        }
      }

      this.logger.log(`[AUDIO] Finished publishing ${totalChunks} audio frames`);
    } catch (error) {
      this.logger.error(`Error playing audio: ${error.message}`);
    } finally {
      session.isSpeaking = false;
    }
  }

  /**
   * Handle a final transcript by processing through the pipeline and TTS.
   */
  private async handleFinalTranscript(
    session: ActiveSession,
    sessionId: string,
    transcript: string,
    participantId: string,
  ): Promise<void> {
    try {
      this.logger.log(`Processing final transcript: "${transcript}"`);

      // Step 1: Process through transcript processor pipeline
      const result = await this.transcriptProcessor.process(
        transcript,
        sessionId,
        participantId,
      );

      if (!result.shouldSpeak) {
        this.logger.debug('Processor indicated no speech needed');
        return;
      }

      // Step 2: Synthesize speech via TTS
      this.logger.log(`Synthesizing: "${result.text}"`);
      const ttsResponse = await this.ttsClient.synthesize(
        result.text,
        sessionId,
      );

      // Step 3: Play audio through agent's audio track
      await this.playAudio(session, sessionId, ttsResponse.audioData);

      this.logger.log(
        `TTS playback complete (${ttsResponse.durationMs}ms): "${result.text}"`,
      );
    } catch (error) {
      this.logger.error(`TTS processing failed: ${error.message}`);
    }
  }

  /**
   * Helper to sleep for a specified duration.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
