import { IsString, IsEmail, IsNotEmpty } from 'class-validator';

export class InviteCollaboratorDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;
}

export class CollaboratorResponseDto {
  userId: string;
  email: string;
  name: string | null;
  role: 'OWNER' | 'COLLABORATOR';
  joinedAt: Date;
}

export class PendingInvitationResponseDto {
  invitationId: string;
  email: string;
  name: string | null;
  status: 'PENDING';
  invitedAt: Date;
}

export class ProjectCollaboratorsResponseDto {
  collaborators: CollaboratorResponseDto[];
  pendingInvitations: PendingInvitationResponseDto[];
}

export class ProjectInvitationResponseDto {
  id: string;
  projectId: string;
  projectName: string;
  inviterId: string;
  inviterName: string | null;
  inviterEmail: string;
  inviteeId: string;
  inviteeName: string | null;
  inviteeEmail: string;
  status: string;
  createdAt: Date;
  respondedAt: Date | null;
}
