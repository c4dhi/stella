import { Module } from '@nestjs/common'
import { AgentPackageModule } from '../agent-package/agent-package.module'
import { BuiltinAgentDiscoveryService } from './builtin-agent-discovery.service'

@Module({
  imports: [AgentPackageModule],
  providers: [BuiltinAgentDiscoveryService],
  exports: [BuiltinAgentDiscoveryService],
})
export class AgentRegistryModule {}
