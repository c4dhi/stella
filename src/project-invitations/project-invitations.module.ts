import { Module } from '@nestjs/common';
import { ProjectInvitationsService } from './project-invitations.service';
import { ProjectInvitationsController } from './project-invitations.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { UserMessagesModule } from '../user-messages/user-messages.module';

@Module({
  imports: [PrismaModule, UserMessagesModule],
  controllers: [ProjectInvitationsController],
  providers: [ProjectInvitationsService],
  exports: [ProjectInvitationsService],
})
export class ProjectInvitationsModule {}
