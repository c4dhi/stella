import { Module } from '@nestjs/common';
import { PublicProjectsController } from './public-projects.controller';
import { PublicProjectsService } from './public-projects.service';
import { SessionsModule } from '../sessions/sessions.module';
import { AgentsModule } from '../agents/agents.module';
import { InvitationsModule } from '../invitations/invitations.module';

@Module({
  imports: [SessionsModule, AgentsModule, InvitationsModule],
  controllers: [PublicProjectsController],
  providers: [PublicProjectsService],
  exports: [PublicProjectsService],
})
export class PublicProjectsModule {}
