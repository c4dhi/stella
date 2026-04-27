import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { PrismaModule } from '../prisma/prisma.module';
import { LiveKitModule } from '../livekit/livekit.module';

@Module({
  imports: [PrismaModule, LiveKitModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
