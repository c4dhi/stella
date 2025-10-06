import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

export class CreateAgentDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(10)  // Emoji is typically 1-4 characters
  icon?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  planId?: string;
}
