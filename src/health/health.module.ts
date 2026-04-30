import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { MediaTestService } from './media-test.service';
import { PrismaModule } from '../prisma/prisma.module';
import { LiveKitModule } from '../livekit/livekit.module';

@Module({
  imports: [PrismaModule, LiveKitModule],
  controllers: [HealthController],
  providers: [HealthService, MediaTestService],
})
export class HealthModule {}
