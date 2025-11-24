import { Module } from '@nestjs/common';
import { AgentsService } from './agents.service';
import { AgentsController } from './agents.controller';
import { KubernetesModule } from '../kubernetes/kubernetes.module';
import { RoomAgentModule } from '../room-agent/room-agent.module';

@Module({
  imports: [KubernetesModule, RoomAgentModule],
  controllers: [AgentsController],
  providers: [AgentsService],
  exports: [AgentsService],
})
export class AgentsModule {}
