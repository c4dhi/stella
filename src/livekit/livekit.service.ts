import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessToken, RoomServiceClient, DataPacket_Kind } from 'livekit-server-sdk';

@Injectable()
export class LiveKitService {
  private readonly logger = new Logger(LiveKitService.name);
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly url: string;           // Internal URL (for backend connections)
  private readonly publicUrl: string;     // Public URL (for frontend/browsers)
  private readonly roomService: RoomServiceClient;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('LIVEKIT_API_KEY');
    const apiSecret = this.configService.get<string>('LIVEKIT_API_SECRET');
    const url = this.configService.get<string>('LIVEKIT_URL');
    const publicUrl = this.configService.get<string>('PUBLIC_LIVEKIT_URL');

    if (!apiKey || !apiSecret || !url || !publicUrl) {
      throw new Error('Missing required LiveKit environment variables: LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL, PUBLIC_LIVEKIT_URL');
    }

    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.url = url;
    this.publicUrl = publicUrl;

    // RoomServiceClient needs an HTTP URL, convert ws:// to http://
    const httpUrl = url.replace(/^ws:\/\//, 'http://').replace(/^wss:\/\//, 'https://');
    this.roomService = new RoomServiceClient(httpUrl, apiKey, apiSecret);
  }

  /**
   * Publish a JSON control message to everyone in a room over the LiveKit data
   * channel (issue #198). Used to signal the agent (e.g. `{type:'session_end'}`)
   * so it can wrap up — the agent already consumes room data, so this rides a
   * working channel instead of the unfinished gRPC duplex.
   */
  async sendData(roomName: string, payload: Record<string, unknown>): Promise<void> {
    const data = new TextEncoder().encode(JSON.stringify(payload));
    await this.roomService.sendData(roomName, data, DataPacket_Kind.RELIABLE, {});
  }

  /**
   * Delete a LiveKit room, which disconnects every participant still in it
   * (issue #198). Called when a session closes so a lingering participant is kicked
   * and their client sees a clean Disconnected event instead of hanging in a dead
   * room. Idempotent server-side: deleting a non-existent room is a no-op.
   */
  async deleteRoom(roomName: string): Promise<void> {
    await this.roomService.deleteRoom(roomName);
  }

  async createToken(
    roomName: string,
    identity: string,
    name?: string,
    ttl?: string | number
  ): Promise<string> {
    const at = new AccessToken(this.apiKey, this.apiSecret, {
      identity,
      name: name || identity,
      ttl: ttl || '24h', // Default to 24 hours for participant tokens
    });

    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    return at.toJwt();
  }

  /**
   * Get internal LiveKit server URL
   * Used by backend for internal operations (connecting to rooms, etc.)
   * This uses ws://host.minikube.internal:7880 in production
   */
  getServerUrl(): string {
    return this.url;
  }

  /**
   * Get publicly accessible LiveKit server URL
   * Used by frontend/browsers to connect to LiveKit
   * This uses the configured public LiveKit URL (e.g. wss://livekit.example.com) in production
   *
   * Backend returns this URL to the frontend for WebRTC connections
   */
  getPublicServerUrl(): string {
    return this.publicUrl;
  }

  getApiKey(): string {
    return this.apiKey;
  }

  getApiSecret(): string {
    return this.apiSecret;
  }

  /**
   * List current participants in a LiveKit room.
   * Queries LiveKit directly (source of truth) rather than relying on DB state.
   */
  async listRoomParticipants(roomName: string): Promise<Array<{ identity: string; name: string }>> {
    try {
      const participants = await this.roomService.listParticipants(roomName);
      return participants.map(p => ({
        identity: p.identity,
        name: p.name,
      }));
    } catch (error) {
      this.logger.error(`Failed to list participants for room ${roomName}: ${error.message}`);
      return [];
    }
  }
}
