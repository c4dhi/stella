import { IsString, IsOptional, IsBoolean, IsNumber, Min, Max } from 'class-validator';

export class CreateInvitationDto {
  @IsOptional()
  @IsString()
  participantName?: string;

  @IsOptional()
  @IsString()
  customMessage?: string;

  @IsOptional()
  @IsString()
  visualizerType?: string;

  @IsOptional()
  @IsBoolean()
  visualizerLocked?: boolean;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(8760) // Max 1 year in hours
  expiresInHours?: number;
}
