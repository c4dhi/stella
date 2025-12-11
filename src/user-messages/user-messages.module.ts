import { Module } from '@nestjs/common';
import { UserMessagesService } from './user-messages.service';
import { UserMessagesController } from './user-messages.controller';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [UserMessagesController],
  providers: [UserMessagesService],
  exports: [UserMessagesService],
})
export class UserMessagesModule {}
