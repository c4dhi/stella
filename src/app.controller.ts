import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { Public } from './common/decorators/public.decorator';
import { LiveKitService } from './livekit/livekit.service';
import * as os from 'os';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly livekit: LiveKitService,
  ) {}

  @Public()
  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Public()
  @Get('health')
  health() {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'session-management-server',
    };
  }

  @Public()
  @Get('network-info')
  getNetworkInfo() {
    // Priority 1: Use explicitly configured public URL (for production or when behind containers)
    if (process.env.PUBLIC_SERVER_URL) {
      return {
        serverUrl: process.env.PUBLIC_SERVER_URL,
        livekitUrl: this.livekit.getPublicServerUrl(),
        hostname: os.hostname(),
        platform: os.platform(),
        source: 'env',
      };
    }

    // Priority 2: Auto-detect, but filter out container/docker networks
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

    const port = process.env.PORT || 3000;
    const serverUrl = `http://${localIp}:${port}`;

    return {
      serverUrl,
      livekitUrl: this.livekit.getPublicServerUrl(),
      hostname: os.hostname(),
      platform: os.platform(),
      source: 'auto-detected',
    };
  }
}
