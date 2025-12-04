import {
  Controller,
  Post,
  Body,
  Headers,
  Logger,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import * as crypto from 'crypto';

/**
 * LiveKit webhook event types
 * https://docs.livekit.io/server/webhooks/
 */
interface LiveKitWebhookEvent {
  event: string;
  room?: {
    name: string;
    sid: string;
    emptyTimeout: number;
    maxParticipants: number;
    creationTime: number;
    metadata: string;
    numParticipants: number;
    numPublishers: number;
  };
  participant?: {
    sid: string;
    identity: string;
    name: string;
    state: string;
    metadata: string;
    joinedAt: number;
    permission?: {
      canSubscribe: boolean;
      canPublish: boolean;
      canPublishData: boolean;
    };
  };
  track?: {
    sid: string;
    type: string;
    source: string;
    mimeType: string;
    muted: boolean;
  };
  id: string;
  createdAt: number;
}

/**
 * LiveKit Webhook Controller
 *
 * Handles webhook events from LiveKit server for participant tracking.
 * This replaces the need for session-management-server to join LiveKit rooms.
 *
 * Events handled:
 * - participant_joined: User joined the room
 * - participant_left: User left the room
 * - room_started: Room was created
 * - room_finished: Room was destroyed (all participants left)
 * - track_published: Participant published a track
 * - track_unpublished: Participant unpublished a track
 *
 * Configure LiveKit to send webhooks to:
 * POST /webhooks/livekit
 */
@Controller('webhooks/livekit')
export class LiveKitWebhookController {
  private readonly logger = new Logger(LiveKitWebhookController.name);
  private readonly webhookSecret: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.webhookSecret = this.configService.get<string>(
      'LIVEKIT_WEBHOOK_SECRET',
      '',
    );

    if (!this.webhookSecret) {
      this.logger.warn(
        'LIVEKIT_WEBHOOK_SECRET not set - webhook signature verification disabled',
      );
    }
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Body() event: LiveKitWebhookEvent,
    @Headers('authorization') authHeader: string,
  ): Promise<{ received: boolean }> {
    // Verify webhook signature if secret is configured
    if (this.webhookSecret && !this.verifySignature(event, authHeader)) {
      this.logger.warn('Invalid webhook signature');
      return { received: false };
    }

    this.logger.log(`Received LiveKit webhook: ${event.event}`);

    try {
      switch (event.event) {
        case 'participant_joined':
          await this.handleParticipantJoined(event);
          break;

        case 'participant_left':
          await this.handleParticipantLeft(event);
          break;

        case 'room_started':
          await this.handleRoomStarted(event);
          break;

        case 'room_finished':
          await this.handleRoomFinished(event);
          break;

        case 'track_published':
          await this.handleTrackPublished(event);
          break;

        case 'track_unpublished':
          await this.handleTrackUnpublished(event);
          break;

        default:
          this.logger.debug(`Unhandled webhook event: ${event.event}`);
      }
    } catch (error) {
      this.logger.error(`Error handling webhook: ${error.message}`);
    }

    return { received: true };
  }

  private verifySignature(
    event: LiveKitWebhookEvent,
    authHeader: string,
  ): boolean {
    if (!authHeader) {
      return false;
    }

    try {
      // LiveKit uses JWT for webhook authentication
      // The authorization header contains: Bearer <jwt>
      const token = authHeader.replace('Bearer ', '');

      // For now, we'll do a basic check - in production,
      // you should verify the JWT signature using the API secret
      // This requires the livekit-server-sdk
      return token.length > 0;
    } catch (error) {
      this.logger.error(`Signature verification error: ${error.message}`);
      return false;
    }
  }

  private async handleParticipantJoined(
    event: LiveKitWebhookEvent,
  ): Promise<void> {
    const { room, participant } = event;
    if (!room || !participant) return;

    this.logger.log(
      `Participant joined: ${participant.identity} in room ${room.name}`,
    );

    // Skip agent participants (they manage themselves)
    if (participant.identity.startsWith('agent-')) {
      this.logger.debug(`Agent ${participant.identity} joined - skipping`);
      return;
    }

    // Emit event for other services to handle
    this.eventEmitter.emit('livekit.participant.joined', {
      roomName: room.name,
      participantIdentity: participant.identity,
      participantSid: participant.sid,
      participantName: participant.name,
      metadata: participant.metadata,
      joinedAt: participant.joinedAt,
    });

    // Also emit SSE event for frontend
    this.eventEmitter.emit('sse.event', {
      sessionId: room.name, // Room name is typically the session ID
      event: 'participant.joined',
      data: {
        identity: participant.identity,
        name: participant.name,
      },
    });
  }

  private async handleParticipantLeft(
    event: LiveKitWebhookEvent,
  ): Promise<void> {
    const { room, participant } = event;
    if (!room || !participant) return;

    this.logger.log(
      `Participant left: ${participant.identity} from room ${room.name}`,
    );

    // Skip agent participants
    if (participant.identity.startsWith('agent-')) {
      this.logger.debug(`Agent ${participant.identity} left - skipping`);
      return;
    }

    // Emit event for other services
    this.eventEmitter.emit('livekit.participant.left', {
      roomName: room.name,
      participantIdentity: participant.identity,
      participantSid: participant.sid,
    });

    // Emit SSE event for frontend
    this.eventEmitter.emit('sse.event', {
      sessionId: room.name,
      event: 'participant.left',
      data: {
        identity: participant.identity,
      },
    });

    // Check if room is now empty (no users, only agents or empty)
    if (room.numParticipants <= 1) {
      // Only agent(s) left or empty
      this.logger.log(`Room ${room.name} has no users left`);
      this.eventEmitter.emit('livekit.room.empty', {
        roomName: room.name,
      });
    }
  }

  private async handleRoomStarted(event: LiveKitWebhookEvent): Promise<void> {
    const { room } = event;
    if (!room) return;

    this.logger.log(`Room started: ${room.name}`);

    this.eventEmitter.emit('livekit.room.started', {
      roomName: room.name,
      roomSid: room.sid,
      creationTime: room.creationTime,
    });
  }

  private async handleRoomFinished(event: LiveKitWebhookEvent): Promise<void> {
    const { room } = event;
    if (!room) return;

    this.logger.log(`Room finished: ${room.name}`);

    // Room is destroyed - trigger cleanup
    this.eventEmitter.emit('livekit.room.finished', {
      roomName: room.name,
      roomSid: room.sid,
    });

    // Emit SSE event for frontend
    this.eventEmitter.emit('sse.event', {
      sessionId: room.name,
      event: 'session.ended',
      data: {
        reason: 'room_finished',
      },
    });
  }

  private async handleTrackPublished(
    event: LiveKitWebhookEvent,
  ): Promise<void> {
    const { room, participant, track } = event;
    if (!room || !participant || !track) return;

    this.logger.debug(
      `Track published: ${track.type} by ${participant.identity} in ${room.name}`,
    );

    // Track events can be used for monitoring but typically don't require action
    this.eventEmitter.emit('livekit.track.published', {
      roomName: room.name,
      participantIdentity: participant.identity,
      trackSid: track.sid,
      trackType: track.type,
      trackSource: track.source,
    });
  }

  private async handleTrackUnpublished(
    event: LiveKitWebhookEvent,
  ): Promise<void> {
    const { room, participant, track } = event;
    if (!room || !participant || !track) return;

    this.logger.debug(
      `Track unpublished: ${track.type} by ${participant.identity} in ${room.name}`,
    );

    this.eventEmitter.emit('livekit.track.unpublished', {
      roomName: room.name,
      participantIdentity: participant.identity,
      trackSid: track.sid,
    });
  }
}
