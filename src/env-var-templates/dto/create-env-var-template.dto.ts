import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsObject,
  IsUUID,
  MinLength,
  MaxLength,
} from 'class-validator';

export class CreateEnvVarTemplateDto {
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
  variables: Record<string, string>;

  @IsUUID()
  @IsOptional()
  agentTypeId?: string;
}
