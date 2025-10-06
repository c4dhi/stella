import { IsEnum, IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { SessionStatus } from '@prisma/client';

export class QuerySessionsDto {
  @IsEnum(SessionStatus)
  @IsOptional()
  status?: SessionStatus;

  @IsString()
  @IsOptional()
  search?: string;

  @IsInt()
  @Min(0)
  @Type(() => Number)
  @IsOptional()
  skip?: number = 0;

  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  @IsOptional()
  take?: number = 20;
}
