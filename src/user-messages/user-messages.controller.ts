import {
  Controller,
  Get,
  Patch,
  Delete,
  Param,
  Query,
  ValidationPipe,
  UsePipes,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { UserMessagesService } from './user-messages.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { QueryMessagesDto } from './dto/user-message.dto';

@Controller('user/messages')
@UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
export class UserMessagesController {
  constructor(private readonly userMessagesService: UserMessagesService) {}

  /**
   * Get paginated messages for the current user
   */
  @Get()
  async getMessages(
    @CurrentUser() user: any,
    @Query() query: QueryMessagesDto,
  ) {
    return this.userMessagesService.getMessages(user.userId, query);
  }

  /**
   * Get unread message count for the current user
   */
  @Get('unread-count')
  async getUnreadCount(@CurrentUser() user: any) {
    return this.userMessagesService.getUnreadCount(user.userId);
  }

  /**
   * Mark a message as read
   */
  @Patch(':messageId/read')
  async markAsRead(
    @CurrentUser() user: any,
    @Param('messageId') messageId: string,
  ) {
    return this.userMessagesService.markAsRead(user.userId, messageId);
  }

  /**
   * Delete a message
   */
  @Delete(':messageId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMessage(
    @CurrentUser() user: any,
    @Param('messageId') messageId: string,
  ) {
    await this.userMessagesService.deleteMessage(user.userId, messageId);
  }
}
