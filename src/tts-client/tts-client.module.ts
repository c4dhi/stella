import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TTSClientService } from './tts-client.service';

@Module({
  imports: [ConfigModule],
  providers: [TTSClientService],
  exports: [TTSClientService],
})
export class TTSClientModule {}
