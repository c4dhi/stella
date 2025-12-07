import { Module } from '@nestjs/common';
import { InvitationsService } from './invitations.service';
import { InvitationsController } from './invitations.controller';
import { LiveKitModule } from '../livekit/livekit.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [LiveKitModule, AuthModule],
  controllers: [InvitationsController],
  providers: [InvitationsService],
  exports: [InvitationsService],
})
export class InvitationsModule {}
