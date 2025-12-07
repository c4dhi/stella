import { IsOptional, IsString } from 'class-validator';

export class AcceptInvitationDto {
  @IsOptional()
  @IsString()
  deviceInfo?: string;

  @IsOptional()
  @IsString()
  browserFingerprint?: string;
}
