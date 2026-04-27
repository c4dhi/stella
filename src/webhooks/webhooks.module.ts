import { Module, forwardRef } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LiveKitWebhookController } from './livekit-webhook.controller';
import { WebhooksService } from './webhooks.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AgentsModule } from '../agents/agents.module';
import { SessionsModule } from '../sessions/sessions.module';
import { LiveKitModule } from '../livekit/livekit.module';
import { EnvVarTemplatesModule } from '../env-var-templates/env-var-templates.module';

/**
 * Webhooks Module
 *
 * Handles incoming webhook events from external services.
 * Currently supports:
 * - LiveKit webhooks for participant and room events
 *
 * Features:
 * - Message-recorder optimization: webhook-driven room management
 * - Agent pausing: on-demand spawning when humans join
 */
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    LiveKitModule,
    // EncryptionService is needed to decrypt manualEnvVarsEncrypted when recreating paused agents.
    EnvVarTemplatesModule,
    forwardRef(() => AgentsModule),
    forwardRef(() => SessionsModule),
  ],
  controllers: [LiveKitWebhookController],
  providers: [WebhooksService],
  exports: [WebhooksService],
})
export class WebhooksModule {}
