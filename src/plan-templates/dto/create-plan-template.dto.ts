import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsObject,
  MinLength,
  MaxLength,
} from 'class-validator';
import { Prisma } from '@prisma/client';

export class CreatePlanTemplateDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  @MaxLength(255)
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  description?: string;

  @IsObject()
  @IsNotEmpty()
  content: Prisma.InputJsonValue;
}
