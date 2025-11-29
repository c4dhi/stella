import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AgentImageService } from './agent-image.service';

@Module({
  imports: [ConfigModule],
  providers: [AgentImageService],
  exports: [AgentImageService],
})
export class AgentImageModule {}
