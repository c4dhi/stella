import { IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryMessagesDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}

export class UserMessageResponseDto {
  id: string;
  type: string;
  title: string;
  body: string | null;
  read: boolean;
  createdAt: Date;
  relatedEntityId: string | null;
  relatedEntityType: string | null;

  // Additional data depending on message type
  metadata?: {
    projectId?: string;
    projectName?: string;
    inviterName?: string;
    inviterEmail?: string;
    invitationId?: string;
  };
}

export class UnreadCountResponseDto {
  count: number;
}

export class PaginatedMessagesResponseDto {
  messages: UserMessageResponseDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
