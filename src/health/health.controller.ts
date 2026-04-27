import { Controller, Get, Header, Logger } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { HealthService } from './health.service';
import { PublicHealthResponse } from './dto/public-health.dto';

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly health: HealthService) {}

  @Public()
  @Get('public')
  @Header('Cache-Control', 'public, max-age=15')
  async getPublic(): Promise<PublicHealthResponse> {
    try {
      return await this.health.getPublicHealth();
    } catch (err) {
      this.logger.error(`public-health probe failed: ${(err as Error).message}`);
      const generatedAt = (() => {
        const d = new Date();
        d.setMilliseconds(0);
        return d.toISOString();
      })();
      return {
        status: 'degraded',
        components: [
          { id: 'api', status: 'operational', lastCheckedAt: generatedAt },
          { id: 'database', status: 'down', lastCheckedAt: generatedAt },
          { id: 'realtime', status: 'down', lastCheckedAt: generatedAt },
          { id: 'stt', status: 'down', lastCheckedAt: generatedAt },
          { id: 'tts', status: 'down', lastCheckedAt: generatedAt },
        ],
        generatedAt,
      };
    }
  }
}
