import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessToken } from 'livekit-server-sdk';

@Injectable()
export class LiveKitService {
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly url: string;           // Internal URL (for backend connections)
  private readonly publicUrl: string;     // Public URL (for frontend/browsers)

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
   * This uses wss://livekit-v1.c4dhi.moserfelix.com in production
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
}
