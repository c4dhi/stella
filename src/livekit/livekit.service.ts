import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccessToken } from 'livekit-server-sdk';
import * as os from 'os';

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

  async createToken(roomName: string, identity: string, name?: string): Promise<string> {
    const at = new AccessToken(this.apiKey, this.apiSecret, {
      identity,
      name: name || identity,
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
   * Priority: PUBLIC_LIVEKIT_URL env var → USE_LOCALHOST check → auto-detect network IP → LIVEKIT_URL fallback
   */
  getPublicServerUrl(): string {
    // Priority 1: Use explicitly configured public URL (for production or when behind containers)
    const publicUrl = this.configService.get<string>('PUBLIC_LIVEKIT_URL');
    if (publicUrl) {
      return publicUrl;
    }

    // Priority 2: Check USE_LOCALHOST setting (defaults to true)
    const useLocalhost = this.configService.get<string>('USE_LOCALHOST');
    const shouldUseLocalhost = useLocalhost !== 'false'; // true if unset or explicitly true

    if (shouldUseLocalhost) {
      // Use localhost - return LIVEKIT_URL as-is
      return this.url;
    }

    // Priority 3: Auto-detect, but filter out container/docker networks
    const detectedIp = this.detectNetworkIp();
    if (detectedIp !== 'localhost') {
      // Extract protocol and port from LIVEKIT_URL
      const urlObj = new URL(this.url);
      const protocol = urlObj.protocol.replace(':', ''); // 'ws' or 'wss'
      const port = urlObj.port || (protocol === 'wss' ? '443' : '7880');
      return `${protocol}://${detectedIp}:${port}`;
    }

    // Priority 4: Fall back to configured LIVEKIT_URL
    return this.url;
  }

  /**
   * Detect local network IP, filtering out container/docker IPs
   */
  private detectNetworkIp(): string {
    const networkInterfaces = os.networkInterfaces();
    let localIp = 'localhost';

    for (const interfaceName of Object.keys(networkInterfaces)) {
      const interfaces = networkInterfaces[interfaceName];
      if (interfaces) {
        for (const iface of interfaces) {
          if (iface.family === 'IPv4' && !iface.internal) {
            const ip = iface.address;
            // Skip container/docker IPs:
            // - 10.x.x.x (Kubernetes pod network, Docker default bridge)
            // - 172.16.x.x to 172.31.x.x (Docker bridge networks)
            // - 169.254.x.x (link-local)
            if (
              !ip.startsWith('10.') &&
              !ip.startsWith('172.') &&
              !ip.startsWith('169.254.')
            ) {
              localIp = ip;
              break;
            }
          }
        }
      }
      if (localIp !== 'localhost') break;
    }

    return localIp;
  }

  getApiKey(): string {
    return this.apiKey;
  }

  getApiSecret(): string {
    return this.apiSecret;
  }
}
