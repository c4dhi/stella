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

    // Auto-generate participant name if not provided
    const participantName = dto.participantName || `user-${Math.floor(Math.random() * 100000)}`;

    // Create the invitation
    const invitation = await this.prisma.invitation.create({
      data: {
        sessionId,
        participantName,
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
   * Can revoke both PENDING (before acceptance) and ACCEPTED (revoke access) invitations
   */
  async revoke(invitationId: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { id: invitationId },
    });

    if (!invitation) {
      throw new NotFoundException(`Invitation with ID ${invitationId} not found`);
    }

    // Only PENDING and ACCEPTED invitations can be revoked
    if (invitation.status !== 'PENDING' && invitation.status !== 'ACCEPTED') {
      throw new BadRequestException(
        `Cannot revoke invitation with status ${invitation.status}. Only PENDING or ACCEPTED invitations can be revoked.`,
      );
    }

    await this.prisma.invitation.update({
      where: { id: invitationId },
      data: { status: InvitationStatus.REVOKED },
    });

    this.logger.log(
      `Revoked invitation ${invitationId} (was ${invitation.status})`,
    );

    return { message: 'Invitation revoked successfully' };
  }

  /**
   * Permanently delete an invitation
   */
  async delete(invitationId: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { id: invitationId },
    });

    if (!invitation) {
      throw new NotFoundException(`Invitation with ID ${invitationId} not found`);
    }

    // Only allow deletion of non-pending invitations or pending ones
    // If it's accepted with a participant, we should not delete to maintain history
    if (invitation.status === 'ACCEPTED' && invitation.participantId) {
      throw new BadRequestException(
        'Cannot delete an accepted invitation with an active participant. Remove the participant first.',
      );
    }

    await this.prisma.invitation.delete({
      where: { id: invitationId },
    });

    this.logger.log(`Deleted invitation ${invitationId}`);

    return { message: 'Invitation deleted successfully' };
  }

  /**
   * Get invitation details by token (public endpoint)
   * Now includes participant activity info for rejoin scenarios
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
        participant: {
          select: {
            id: true,
            lastSeenAt: true,
            leftAt: true,
          },
        },
      },
    });

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    // Check basic validity (expiration, session status) but allow ACCEPTED for rejoin
    this.validateInvitationForView(invitation);

    // Determine if participant is currently active (seen in last 30 seconds and hasn't left)
    const ACTIVE_THRESHOLD_MS = 30000; // 30 seconds
    const isParticipantActive =
      invitation.participant &&
      !invitation.participant.leftAt &&
      invitation.participant.lastSeenAt &&
      Date.now() - new Date(invitation.participant.lastSeenAt).getTime() <
        ACTIVE_THRESHOLD_MS;

    // Return information needed for the participant join page
    return {
      participantName: invitation.participantName,
      customMessage: invitation.customMessage,
      visualizerType: invitation.visualizerType,
      visualizerLocked: invitation.visualizerLocked,
      sessionName: invitation.session.name,
      status: invitation.status,
      // Include participant info for rejoin scenarios
      participant: invitation.participant
        ? {
            id: invitation.participant.id,
            isActive: isParticipantActive,
          }
        : null,
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
   * Rejoin an already accepted invitation (public endpoint)
   * Returns connection info for an existing participant
   */
  async rejoin(token: string) {
    const invitation = await this.prisma.invitation.findUnique({
      where: { token },
      include: {
        session: {
          include: { room: true },
        },
        participant: true,
      },
    });

    if (!invitation) {
      throw new NotFoundException('Invitation not found');
    }

    // Can only rejoin ACCEPTED invitations
    if (invitation.status !== 'ACCEPTED') {
      throw new BadRequestException(
        `Cannot rejoin invitation with status ${invitation.status}. Use accept for new invitations.`,
      );
    }

    // Must have a participant record
    if (!invitation.participant) {
      throw new BadRequestException(
        'No participant found for this invitation. Please contact support.',
      );
    }

    // Check basic validity (expiration, session status)
    this.validateInvitationForView(invitation);

    if (!invitation.session.room) {
      throw new BadRequestException('Session does not have an associated room');
    }

    // Check if participant is currently active (someone else using the session)
    const ACTIVE_THRESHOLD_MS = 30000; // 30 seconds
    const isActive =
      !invitation.participant.leftAt &&
      invitation.participant.lastSeenAt &&
      Date.now() - new Date(invitation.participant.lastSeenAt).getTime() <
        ACTIVE_THRESHOLD_MS;

    if (isActive) {
      throw new BadRequestException(
        'This session is currently in use. Please wait for the other participant to leave.',
      );
    }

    // Reset participant's leftAt to allow rejoin
    await this.prisma.participant.update({
      where: { id: invitation.participant.id },
      data: {
        leftAt: null,
        lastTokenRefresh: new Date(),
      },
    });

    // Generate new LiveKit token for this participant
    const livekitToken = await this.livekit.createToken(
      invitation.session.room.livekitRoomName,
      invitation.participant.identity,
      invitation.participant.name,
    );

    // Generate new participant JWT for API authentication
    const participantToken = this.authService.generateParticipantToken(
      invitation.participant.id,
      invitation.sessionId,
    );

    // Get public LiveKit URL
    const publicLivekitUrl = this.livekit.getPublicServerUrl();

    this.logger.log(
      `Participant ${invitation.participant.id} rejoined invitation ${invitation.id}`,
    );

    return {
      participantId: invitation.participant.id,
      participantName: invitation.participant.name,
      identity: invitation.participant.identity,
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
   * Validate that an invitation can still be used (for new acceptance)
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
   * Validate invitation for viewing (allows ACCEPTED for rejoin scenarios)
   */
  private validateInvitationForView(invitation: {
    status: InvitationStatus;
    expiresAt: Date | null;
    session: { status: string };
  }) {
    // REVOKED invitations cannot be viewed
    if (invitation.status === 'REVOKED') {
      throw new BadRequestException('This invitation has been revoked');
    }

    // EXPIRED invitations cannot be viewed
    if (invitation.status === 'EXPIRED') {
      throw new BadRequestException('This invitation has expired');
    }

    // Check time-based expiration
    if (invitation.expiresAt && new Date() > invitation.expiresAt) {
      throw new BadRequestException('This invitation has expired');
    }

    // Check session status
    if (invitation.session.status !== 'ACTIVE') {
      throw new BadRequestException('The session is no longer active');
    }

    // ACCEPTED and PENDING are both allowed for viewing
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
