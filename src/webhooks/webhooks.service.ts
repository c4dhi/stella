import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';

interface ParticipantJoinedEvent {
  roomName: string;
  participantIdentity: string;
  participantSid: string;
  participantName?: string;
  metadata?: string;
  joinedAt?: number;
}

interface ParticipantLeftEvent {
  roomName: string;
  participantIdentity: string;
  participantSid: string;
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Handle participant joined event from LiveKit webhook
   * Updates participant presence status in database
   */
  @OnEvent('livekit.participant.joined')
  async handleParticipantJoined(event: ParticipantJoinedEvent): Promise<void> {
    const { roomName, participantIdentity, participantName } = event;

    this.logger.log(
      `Updating presence for joined participant: ${participantIdentity} in room ${roomName}`,
    );

    try {
      // Find the session by room name
      const room = await this.prisma.room.findUnique({
        where: { livekitRoomName: roomName },
        select: { sessionId: true },
      });

      if (!room) {
        this.logger.warn(`Room not found for LiveKit room: ${roomName}`);
        return;
      }

      // Update participant's lastSeenAt to mark them as online
      const result = await this.prisma.participant.updateMany({
        where: {
          sessionId: room.sessionId,
          identity: participantIdentity,
        },
        data: {
          lastSeenAt: new Date(),
          leftAt: null, // Clear leftAt to mark as online
        },
      });

      if (result.count > 0) {
        this.logger.log(
          `Updated presence for participant ${participantIdentity} - marked as online`,
        );
      } else {
        this.logger.debug(
          `No participant found with identity ${participantIdentity} in session ${room.sessionId}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to update participant presence on join: ${error.message}`,
      );
    }
  }

  /**
   * Handle participant left event from LiveKit webhook
   * Updates participant presence status in database
   */
  @OnEvent('livekit.participant.left')
  async handleParticipantLeft(event: ParticipantLeftEvent): Promise<void> {
    const { roomName, participantIdentity } = event;

    this.logger.log(
      `Updating presence for left participant: ${participantIdentity} from room ${roomName}`,
    );

    try {
      // Find the session by room name
      const room = await this.prisma.room.findUnique({
        where: { livekitRoomName: roomName },
        select: { sessionId: true },
      });

      if (!room) {
        this.logger.warn(`Room not found for LiveKit room: ${roomName}`);
        return;
      }

      // Update participant's lastSeenAt and leftAt to mark them as offline
      const result = await this.prisma.participant.updateMany({
        where: {
          sessionId: room.sessionId,
          identity: participantIdentity,
        },
        data: {
          lastSeenAt: new Date(),
          leftAt: new Date(), // Set leftAt to mark as offline
        },
      });

      if (result.count > 0) {
        this.logger.log(
          `Updated presence for participant ${participantIdentity} - marked as offline`,
        );
      }
    } catch (error) {
      this.logger.error(
        `Failed to update participant presence on leave: ${error.message}`,
      );
    }
  }
}
