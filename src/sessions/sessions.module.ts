import { Module, forwardRef } from '@nestjs/common';
import { SessionsService } from './sessions.service';
import { SessionsController } from './sessions.controller';
import { LiveKitModule } from '../livekit/livekit.module';
import { AgentsModule } from '../agents/agents.module';
import { MessageRecorderModule } from '../message-recorder/message-recorder.module';

@Module({
  imports: [LiveKitModule, forwardRef(() => AgentsModule), MessageRecorderModule],
  controllers: [SessionsController],
  providers: [SessionsService],
  exports: [SessionsService],
})
export class SessionsModule {}
