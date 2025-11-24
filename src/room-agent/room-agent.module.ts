import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RoomAgentService } from './room-agent.service';
import { LiveKitModule } from '../livekit/livekit.module';
import { STTClientModule } from '../stt-client/stt-client.module';

@Module({
  imports: [ConfigModule, LiveKitModule, STTClientModule],
  providers: [RoomAgentService],
  exports: [RoomAgentService],
})
export class RoomAgentModule {}
