import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LiveKitWebhookController } from './livekit-webhook.controller';
import { WebhooksService } from './webhooks.service';
import { PrismaModule } from '../prisma/prisma.module';

/**
 * Webhooks Module
 *
 * Handles incoming webhook events from external services.
 * Currently supports:
 * - LiveKit webhooks for participant and room events
 */
@Module({
  imports: [ConfigModule, PrismaModule],
  controllers: [LiveKitWebhookController],
  providers: [WebhooksService],
  exports: [WebhooksService],
})
export class WebhooksModule {}
