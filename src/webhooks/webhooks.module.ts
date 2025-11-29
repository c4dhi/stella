import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LiveKitWebhookController } from './livekit-webhook.controller';

/**
 * Webhooks Module
 *
 * Handles incoming webhook events from external services.
 * Currently supports:
 * - LiveKit webhooks for participant and room events
 */
@Module({
  imports: [ConfigModule],
  controllers: [LiveKitWebhookController],
})
export class WebhooksModule {}
