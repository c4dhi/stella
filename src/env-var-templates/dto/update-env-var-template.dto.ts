import {
  IsString,
  IsOptional,
  IsObject,
  IsArray,
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

  // Keys to add or overwrite. Merged on top of the existing (decrypted) values,
  // so the client only sends the secrets it actually changed — untouched keys
  // keep their stored value and never need re-entry. Omit to leave values as-is.
  @IsObject()
  @IsOptional()
  variables?: Record<string, string>;

  // Keys to delete from the template. Lets the client remove a variable without
  // having to re-send (and therefore re-type) the secrets it is keeping.
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  removeKeys?: string[];

  // agentTypeId is intentionally omitted: a template's agent type is immutable
  // after creation. To rebind, duplicate the template under the desired type.
}
