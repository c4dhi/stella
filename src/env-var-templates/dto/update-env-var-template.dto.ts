import {
  IsString,
  IsOptional,
  IsObject,
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

  // agentTypeId is intentionally omitted: a template's agent type is immutable
  // after creation. To rebind, duplicate the template under the desired type.
}
