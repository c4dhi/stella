import { IsString, IsNotEmpty, MinLength, MaxLength, IsOptional, IsInt, Min, Max } from 'class-validator';

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1440) // Max 24 hours
  agentInactivityTimeoutMinutes?: number | null;
}
