import { Module } from '@nestjs/common';
import { AgentConfigurationsService } from './agent-configurations.service';
import { AgentConfigurationsController } from './agent-configurations.controller';

@Module({
  controllers: [AgentConfigurationsController],
  providers: [AgentConfigurationsService],
  exports: [AgentConfigurationsService],
})
export class AgentConfigurationsModule {}
