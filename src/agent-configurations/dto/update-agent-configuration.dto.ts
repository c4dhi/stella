import {
  IsString,
  IsOptional,
  IsObject,
  MinLength,
  MaxLength,
} from 'class-validator';
import { Prisma } from '@prisma/client';

export class UpdateAgentConfigurationDto {
  @IsString()
  @IsOptional()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string;

  @IsObject()
  @IsOptional()
  configuration?: Prisma.InputJsonValue;

  @IsString()
  @IsOptional()
  @MaxLength(50)
  agentVersion?: string;
}
