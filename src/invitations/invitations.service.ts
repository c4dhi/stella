import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { LiveKitService } from '../livekit/livekit.service';
import { AuthService } from '../auth/auth.service';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { AcceptInvitationDto } from './dto/accept-invitation.dto';
import { InvitationStatus } from '@prisma/client';

@Injectable()
export class InvitationsService {
  private readonly logger = new Logger(InvitationsService.name);

  constructor(
    private prisma: PrismaService,
    private livekit: LiveKitService,
    private authService: AuthService,
    private configService: ConfigService,
  ) {}

  /**
   * Create a new invitation for a session
   */
  async create(sessionId: string, dto: CreateInvitationDto) {
    // Verify session exists and is active
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      include: { room: true },
    });

    if (!session) {
      throw new NotFoundException(`Session with ID ${sessionId} not found`);
    }

    if (session.status !== 'ACTIVE') {
      throw new BadRequestException('Cannot create invitation for a closed session');
    }

    if (!session.room) {
      throw new BadRequestException('Session does not have an associated room');
    }

    // Calculate expiration date if provided
    const expiresAt = dto.expiresInHours
      ? new Date(Date.now() + dto.expiresInHours * 60 * 60 * 1000)
      : null;

    // Create the invitation
    const invitation = await this.prisma.invitation.create({
      data: {
        sessionId,
        participantName: dto.participantName,
        customMessage: dto.customMessage,
        visualizerType: dto.visualizerType,
        visualizerLocked: dto.visualizerLocked ?? false,
        expiresAt,
      },
    });

    // Generate the join URL using the frontend URL
    const baseUrl = this.configService.get<string>('PUBLIC_FRONTEND_URL') || 'http://localhost:8080';
    const joinUrl = `${baseUrl}/join/${invitation.token}`;

    this.logger.log(`Created invitation ${invitation.id} for session ${sessionId}`);

    return {
      invitation,
      joinUrl,
    };
  }

  /**
   * List all invitations for a session
   */
  async findBySession(sessionId: string) {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
    });

    if (!session) {
      throw new NotFoundException(`Session with ID ${sessionId} not found`);
    }

    return this.prisma.invitation.findMany({
      where: { sessionId },
      include: {
        participant: {
          select: {
            id: true,
            name: true,
            identity: true,
            joinedAt: true,
            leftAt: true,
            lastSeenAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get invitation by ID (for organizer)
   */
  async findOne(invitationId: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { id: invitationId },
      include: {
        session: {
          select: {
            id: true,
            name: true,
            status: true,
          },
        },
        participant: {
          select: {
            id: true,
            name: true,
            identity: true,
            joinedAt: true,
            leftAt: true,
            lastSeenAt: true,
          },
        },
      },
    });

    if (!invitation) {
      throw new NotFoundException(`Invitation with ID ${invitationId} not found`);
    }

    return invitation;
  }

  /**
   * Revoke an invitation
   */
  async revoke(invitationId: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { id: invitationId },
    });

    if (!invitation) {
      throw new NotFoundException(`Invitation with ID ${invitationId} not found`);
    }

    if (invitation.status !== 'PENDING') {
      throw new BadRequestException(`Cannot revoke invitation with status ${invitation.status}`);
    }

    await this.prisma.invitation.update({
      where: { id: invitationId },
      data: { status: InvitationStatus.REVOKED },
    });

    this.logger.log(`Revoked invitation ${invitationId}`);

    return { message: 'Invitation revoked successfully' };
  }

  /**
   * Get invitation details by token (public endpoint)
   */
  async getByToken(token: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { token },
      include: {
        session: {
          select: {
            id: true,
            name: true,
            status: true,
          },
        },
      },
    });

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    // Check if invitation is still valid
    this.validateInvitation(invitation);

    // Return only the information needed for the participant
    return {
      participantName: invitation.participantName,
      customMessage: invitation.customMessage,
      visualizerType: invitation.visualizerType,
      visualizerLocked: invitation.visualizerLocked,
      sessionName: invitation.session.name,
      status: invitation.status,
    };
  }

  /**
   * Accept an invitation and create participant (public endpoint)
   */
  async accept(token: string, dto: AcceptInvitationDto) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { token },
      include: {
        session: {
          include: { room: true },
        },
      },
    });

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    // Validate the invitation
    this.validateInvitation(invitation);

    if (!invitation.session.room) {
      throw new BadRequestException('Session does not have an associated room');
    }

    // Generate unique identity for this participant
    const identity = `participant-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Create participant in database
    const participant = await this.prisma.participant.create({
      data: {
        sessionId: invitation.sessionId,
        name: invitation.participantName,
        identity,
        isManuallyRegistered: true,
        lastTokenRefresh: new Date(),
      },
    });

    // Update invitation status and link to participant
    await this.prisma.invitation.update({
      where: { id: invitation.id },
      data: {
        status: InvitationStatus.ACCEPTED,
        acceptedAt: new Date(),
        participantId: participant.id,
      },
    });

    // Generate LiveKit token for this participant
    const livekitToken = await this.livekit.createToken(
      invitation.session.room.livekitRoomName,
      identity,
      invitation.participantName,
    );

    // Generate participant JWT for API authentication
    const participantToken = this.authService.generateParticipantToken(
      participant.id,
      invitation.sessionId,
    );

    // Get public LiveKit URL
    const publicLivekitUrl = this.livekit.getPublicServerUrl();

    this.logger.log(
      `Invitation ${invitation.id} accepted - participant ${participant.id} created`,
    );

    return {
      participantId: participant.id,
      participantName: participant.name,
      identity: participant.identity,
      token: participantToken,
      connectionInfo: {
        token: livekitToken,
        serverUrl: publicLivekitUrl,
        roomName: invitation.session.room.livekitRoomName,
      },
      visualizerType: invitation.visualizerType,
      visualizerLocked: invitation.visualizerLocked,
    };
  }

  /**
   * Validate that an invitation can still be used
   */
  private validateInvitation(invitation: {
    status: InvitationStatus;
    expiresAt: Date | null;
    session: { status: string };
  }) {
    // Check invitation status
    if (invitation.status === 'ACCEPTED') {
      throw new BadRequestException('This invitation has already been used');
    }

    if (invitation.status === 'REVOKED') {
      throw new BadRequestException('This invitation has been revoked');
    }

    if (invitation.status === 'EXPIRED') {
      throw new BadRequestException('This invitation has expired');
    }

    // Check expiration
    if (invitation.expiresAt && new Date() > invitation.expiresAt) {
      throw new BadRequestException('This invitation has expired');
    }

    // Check session status
    if (invitation.session.status !== 'ACTIVE') {
      throw new BadRequestException('The session is no longer active');
    }
  }

  /**
   * Check and update expired invitations (can be called by a cron job)
   */
  async updateExpiredInvitations() {
    const result = await this.prisma.invitation.updateMany({
      where: {
        status: 'PENDING',
        expiresAt: { lt: new Date() },
      },
      data: { status: InvitationStatus.EXPIRED },
    });

    if (result.count > 0) {
      this.logger.log(`Marked ${result.count} invitations as expired`);
    }

    return result;
  }
}
