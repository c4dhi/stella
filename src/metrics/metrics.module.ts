import { Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import { PrismaModule } from '../prisma/prisma.module';

/**
 * MetricsModule - Real-time metrics and analytics
 *
 * Provides centralized metrics collection for:
 * - Project dashboards (sessions, agents, participants, messages)
 * - Future admin dashboard (global system metrics)
 * - Future alerting system
 */
@Module({
  imports: [PrismaModule],
  controllers: [MetricsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
