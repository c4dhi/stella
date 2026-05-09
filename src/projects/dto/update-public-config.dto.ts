import {
  IsBoolean,
  IsString,
  IsOptional,
  IsDateString,
  IsUUID,
  ValidateNested,
  IsObject,
  IsInt,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Agent configuration for public projects
 */
export class PublicAgentConfigDto {
  @IsString()
  @MaxLength(255)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(10)
  icon?: string;

  @IsOptional()
  @IsObject()
  plan?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  pipelineConfig?: Record<string, unknown>;

  @IsOptional()
  @IsUUID()
  envVarTemplateId?: string;

  @IsOptional()
  @IsObject()
  envVars?: Record<string, string>;
}

/**
 * DTO for configuring public project settings
 */
export class UpdatePublicConfigDto {
  @IsBoolean()
  isPublic: boolean;

  @IsOptional()
  @IsUUID()
  agentTypeId?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => PublicAgentConfigDto)
  agentConfig?: PublicAgentConfigDto;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  visualizerType?: string;

  @IsOptional()
  @IsBoolean()
  visualizerLocked?: boolean;

  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  // Max session duration in seconds; null/undefined = no limit (default). Max 7200 (2h).
  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(7200)
  maxSessionDurationSeconds?: number | null;
}
