import { IsString, IsOptional, MaxLength, IsIn } from 'class-validator';

export class CreateSessionDto {
  @IsString()
  @IsOptional()
  @MaxLength(255)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(255)
  planId?: string;

  /**
   * Agent spawn mode for resource optimization:
   * - 'immediate': Agents spawn immediately when session is created (default)
   * - 'on_demand': Agents spawn only when a human joins the LiveKit room
   */
  @IsString()
  @IsOptional()
  @IsIn(['immediate', 'on_demand'])
  agentSpawnMode?: 'immediate' | 'on_demand';
}
