import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { KubernetesService } from './kubernetes.service';
import { AgentImageModule } from '../agent-image/agent-image.module';
import { EnvVarTemplatesModule } from '../env-var-templates/env-var-templates.module';

@Module({
  imports: [ConfigModule, AgentImageModule, EnvVarTemplatesModule],
  providers: [KubernetesService],
  exports: [KubernetesService],
})
export class KubernetesModule {}
