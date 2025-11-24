import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { STTClientService } from './stt-client.service';

@Module({
  imports: [ConfigModule],
  providers: [STTClientService],
  exports: [STTClientService],
})
export class STTClientModule {}
