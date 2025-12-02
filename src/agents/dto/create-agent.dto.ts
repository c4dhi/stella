import { IsString, IsNotEmpty, IsOptional, MaxLength, IsBoolean, IsObject } from 'class-validator';

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
  agentType?: string;  // Agent type identifier (e.g., "grace-agent") for gRPC orchestrator

  @IsObject()
  @IsOptional()
  config?: Record<string, unknown>;  // Agent-specific config (e.g., { plan_id: "grace_smalltalk" })

  @IsBoolean()
  @IsOptional()
  forceRebuild?: boolean;  // Force rebuild the agent image (useful after SDK updates)
}
