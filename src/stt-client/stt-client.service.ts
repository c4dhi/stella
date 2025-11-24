import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { EventEmitter } from 'events';
import * as path from 'path';

export interface AudioChunk {
  audioData: Buffer;
  sessionId: string;
  participantId: string;
  timestampMs: number;
}

export interface TranscriptEvent {
  text: string;
  isFinal: boolean;
  transcriptId: string;
  participantId: string;
  confidence: number;
  timestampMs: number;
}

export interface HealthStatus {
  healthy: boolean;
  modelStatus: string;
  version: string;
}

/**
 * Wrapper for gRPC bidirectional stream with EventEmitter interface.
 */
export class STTStream extends EventEmitter {
  private call: grpc.ClientDuplexStream<any, any>;
  private sessionId: string;
  private participantId: string;

  constructor(
    call: grpc.ClientDuplexStream<any, any>,
    sessionId: string,
    participantId: string,
  ) {
    super();
    this.call = call;
    this.sessionId = sessionId;
    this.participantId = participantId;

    // Handle incoming transcript events (snake_case from proto with keepCase: true)
    this.call.on('data', (event: any) => {
      this.emit('data', {
        text: event.text,
        isFinal: event.is_final,
        transcriptId: event.transcript_id,
        participantId: event.participant_id,
        confidence: event.confidence,
        timestampMs: Number(event.timestamp_ms || 0),
      } as TranscriptEvent);
    });

    this.call.on('error', (err: Error) => {
      this.emit('error', err);
    });

    this.call.on('end', () => {
      this.emit('end');
    });
  }

  write(chunk: AudioChunk): boolean {
    // keepCase: true means we use snake_case to match proto field names
    return this.call.write({
      audio_data: chunk.audioData,
      session_id: chunk.sessionId,
      participant_id: chunk.participantId,
      timestamp_ms: chunk.timestampMs,
    });
  }

  end(): void {
    this.call.end();
  }

  cancel(): void {
    this.call.cancel();
  }
}

@Injectable()
export class STTClientService implements OnModuleInit {
  private readonly logger = new Logger(STTClientService.name);
  private client: any;
  private serviceUrl: string;
  private proto: any;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    this.serviceUrl = this.configService.get<string>(
      'STT_SERVICE_URL',
      'stt-service:50051',
    );

    const protoPath = path.join(
      process.cwd(),
      'proto',
      'stt.proto',
    );

    this.logger.log(`Loading proto from: ${protoPath}`);

    const packageDefinition = protoLoader.loadSync(protoPath, {
      keepCase: true,  // Keep snake_case to match Python/proto wire format
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });

    this.proto = grpc.loadPackageDefinition(packageDefinition) as any;

    this.client = new this.proto.stt.SpeechToText(
      this.serviceUrl,
      grpc.credentials.createInsecure(),
      {
        'grpc.max_receive_message_length': 50 * 1024 * 1024,
        'grpc.max_send_message_length': 50 * 1024 * 1024,
      },
    );

    this.logger.log(`STT client initialized, connecting to ${this.serviceUrl}`);
  }

  /**
   * Create a bidirectional streaming connection to STT service.
   * Returns a stream that can write audio chunks and emit transcript events.
   */
  createStream(sessionId: string, participantId: string): STTStream {
    const call = this.client.StreamTranscribe();
    return new STTStream(call, sessionId, participantId);
  }

  /**
   * Health check for the STT service.
   */
  async healthCheck(): Promise<HealthStatus> {
    return new Promise((resolve, reject) => {
      this.client.HealthCheck({}, (err: Error | null, response: any) => {
        if (err) {
          this.logger.error(`Health check failed: ${err.message}`);
          reject(err);
        } else {
          resolve({
            healthy: response.healthy,
            modelStatus: response.model_status,
            version: response.version,
          });
        }
      });
    });
  }

  /**
   * Check if STT service is available.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const status = await this.healthCheck();
      return status.healthy;
    } catch {
      return false;
    }
  }
}
