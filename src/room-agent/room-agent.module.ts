import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { RoomAgentService } from './room-agent.service';
import { LiveKitModule } from '../livekit/livekit.module';
import { STTClientModule } from '../stt-client/stt-client.module';
import { TTSClientModule } from '../tts-client/tts-client.module';
import { TranscriptProcessorModule } from '../transcript-processor/transcript-processor.module';

@Module({
  imports: [
    ConfigModule,
    LiveKitModule,
    STTClientModule,
    TTSClientModule,
    TranscriptProcessorModule,
  ],
  providers: [RoomAgentService],
  exports: [RoomAgentService],
})
export class RoomAgentModule {}
