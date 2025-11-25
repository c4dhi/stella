import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import * as path from 'path';

export interface SynthesizeRequest {
  text: string;
  sessionId: string;
  voice?: string;
  speed?: number;
}

export interface SynthesizeResponse {
  audioData: Buffer;
  sampleRate: number;
  durationMs: number;
}

export interface HealthStatus {
  healthy: boolean;
  provider: string;
  version: string;
}

@Injectable()
export class TTSClientService implements OnModuleInit {
  private readonly logger = new Logger(TTSClientService.name);
  private client: any;
  private serviceUrl: string;
  private proto: any;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    this.serviceUrl = this.configService.get<string>(
      'TTS_SERVICE_URL',
      'tts-service:50052',
    );

    const protoPath = path.join(process.cwd(), 'proto', 'tts.proto');

    this.logger.log(`Loading TTS proto from: ${protoPath}`);

    const packageDefinition = protoLoader.loadSync(protoPath, {
      keepCase: true, // Keep snake_case to match Python/proto wire format
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
    });

    this.proto = grpc.loadPackageDefinition(packageDefinition) as any;

    this.client = new this.proto.tts.TextToSpeech(
      this.serviceUrl,
      grpc.credentials.createInsecure(),
      {
        'grpc.max_receive_message_length': 50 * 1024 * 1024,
        'grpc.max_send_message_length': 50 * 1024 * 1024,
      },
    );

    this.logger.log(`TTS client initialized, connecting to ${this.serviceUrl}`);
  }

  /**
   * Synthesize text to audio.
   * Returns raw PCM audio data (16-bit, 16kHz, mono).
   */
  async synthesize(
    text: string,
    sessionId: string,
    voice?: string,
    speed?: number,
  ): Promise<SynthesizeResponse> {
    return new Promise((resolve, reject) => {
      const request = {
        text,
        session_id: sessionId,
        voice: voice || '',
        speed: speed || 1.0,
      };

      this.logger.debug(`[TTS] Calling Synthesize for: "${text.substring(0, 50)}..."`);

      this.client.Synthesize(request, (err: Error | null, response: any) => {
        if (err) {
          this.logger.error(`[TTS] Synthesize failed: ${err.message}`);
          reject(err);
        } else {
          const audioData = Buffer.from(response.audio_data);
          this.logger.log(
            `[TTS] Received audio: ${audioData.length} bytes, ${response.sample_rate}Hz, ${response.duration_ms}ms`,
          );
          resolve({
            audioData,
            sampleRate: response.sample_rate,
            durationMs: response.duration_ms,
          });
        }
      });
    });
  }

  /**
   * Synthesize text to streaming audio chunks.
   * Yields chunks as they become available.
   */
  async *synthesizeStream(
    text: string,
    sessionId: string,
    voice?: string,
    speed?: number,
  ): AsyncGenerator<{ audioData: Buffer; isFinal: boolean; chunkIndex: number }> {
    const request = {
      text,
      session_id: sessionId,
      voice: voice || '',
      speed: speed || 1.0,
    };

    const call = this.client.SynthesizeStream(request);

    // Convert to async iterator
    const chunks: Array<{ audioData: Buffer; isFinal: boolean; chunkIndex: number }> = [];
    let resolveNext: (() => void) | null = null;
    let error: Error | null = null;
    let ended = false;

    call.on('data', (chunk: any) => {
      chunks.push({
        audioData: Buffer.from(chunk.audio_data),
        isFinal: chunk.is_final,
        chunkIndex: chunk.chunk_index,
      });
      if (resolveNext) {
        resolveNext();
        resolveNext = null;
      }
    });

    call.on('error', (err: Error) => {
      error = err;
      if (resolveNext) {
        resolveNext();
        resolveNext = null;
      }
    });

    call.on('end', () => {
      ended = true;
      if (resolveNext) {
        resolveNext();
        resolveNext = null;
      }
    });

    // Yield chunks as they arrive
    while (true) {
      if (error) {
        throw error;
      }

      if (chunks.length > 0) {
        yield chunks.shift()!;
        continue;
      }

      if (ended) {
        break;
      }

      // Wait for next chunk
      await new Promise<void>((resolve) => {
        resolveNext = resolve;
      });
    }
  }

  /**
   * Health check for the TTS service.
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
            provider: response.provider,
            version: response.version,
          });
        }
      });
    });
  }

  /**
   * Check if TTS service is available.
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
