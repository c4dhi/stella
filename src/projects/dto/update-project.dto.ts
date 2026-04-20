import { IsString, IsNotEmpty, MinLength, MaxLength, IsOptional, ValidateIf, IsInt, Min, Max } from 'class-validator';

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @ValidateIf((o) => o.agentInactivityTimeoutMinutes !== null)
  @IsInt()
  @Min(1)
  @Max(1440) // Max 24 hours
  agentInactivityTimeoutMinutes?: number | null;

  @IsOptional()
  @ValidateIf((o) => o.sessionInactivityEndMinutes !== null)
  @IsInt()
  @Min(1)
  @Max(1440)
  sessionInactivityEndMinutes?: number | null;

  @IsOptional()
  @ValidateIf((o) => o.sessionMaxDurationMinutes !== null)
  @IsInt()
  @Min(1)
  @Max(1440)
  sessionMaxDurationMinutes?: number | null;
}
