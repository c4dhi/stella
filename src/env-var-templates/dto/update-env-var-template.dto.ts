import {
  IsString,
  IsOptional,
  IsObject,
  IsUUID,
  MinLength,
  MaxLength,
} from 'class-validator';

export class UpdateEnvVarTemplateDto {
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
  variables?: Record<string, string>;

  @IsUUID()
  @IsOptional()
  agentTypeId?: string;
}
