import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { KubernetesService } from './kubernetes.service';
import { AgentImageModule } from '../agent-image/agent-image.module';

@Module({
  imports: [ConfigModule, AgentImageModule],
  providers: [KubernetesService],
  exports: [KubernetesService],
})
export class KubernetesModule {}
