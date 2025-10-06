import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { LiveKitModule } from '../livekit/livekit.module';
import { MessageRecorderService } from './message-recorder.service';
import { RoomMonitorService } from './room-monitor.service';

@Module({
  imports: [PrismaModule, LiveKitModule],
  providers: [MessageRecorderService, RoomMonitorService],
  exports: [MessageRecorderService, RoomMonitorService],
})
export class MessageRecorderModule {}
