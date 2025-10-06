import { IsString, IsOptional, MaxLength } from 'class-validator';

export class CreateSessionDto {
  @IsString()
  @IsOptional()
  @MaxLength(255)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  planId?: string;
}
