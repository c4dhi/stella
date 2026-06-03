import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsObject,
  MinLength,
  MaxLength,
} from 'class-validator';
import { Prisma } from '@prisma/client';

export class CreateAgentConfigurationDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string;

  @IsString()
  @IsNotEmpty()
  agentTypeId: string;

  @IsObject()
  @IsNotEmpty()
  configuration: Prisma.InputJsonValue;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  agentVersion?: string;

  // Minimum SDK prompt-compiler version this config's prompts require. Defaults to
  // the agent type's current compilerVersion at creation time when omitted.
  @IsString()
  @IsOptional()
  @MaxLength(50)
  minCompilerVersion?: string;
}
