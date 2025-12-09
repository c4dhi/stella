import { IsString, IsNotEmpty, MaxLength, IsOptional } from 'class-validator';

export class GeneratePlanTemplateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  prompt: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  context?: string; // For future multi-turn support
}
