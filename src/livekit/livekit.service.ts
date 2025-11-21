import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessToken } from 'livekit-server-sdk';

@Injectable()
export class LiveKitService {
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly url: string;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>('LIVEKIT_API_KEY');
    const apiSecret = this.configService.get<string>('LIVEKIT_API_SECRET');
    const url = this.configService.get<string>('LIVEKIT_URL');

    if (!apiKey || !apiSecret || !url) {
      throw new Error('Missing required LiveKit environment variables: LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL');
    }

    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.url = url;
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

  getServerUrl(): string {
    return this.url;
  }

  /**
   * Get publicly accessible LiveKit server URL
   * Since LiveKit is hosted externally, LIVEKIT_URL is the public URL
   * that all services (backend, frontend, agents) should use
   */
  getPublicServerUrl(): string {
    return this.url;
  }

  getApiKey(): string {
    return this.apiKey;
  }

  getApiSecret(): string {
    return this.apiSecret;
  }
}
