import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'
import { PrismaModule } from '../prisma/prisma.module'
import { AgentPackageModule } from '../agent-package/agent-package.module'
import { AgentBuildService } from './agent-build.service'

@Module({
  imports: [ConfigModule, PrismaModule, AgentPackageModule],
  providers: [AgentBuildService],
  exports: [AgentBuildService],
})
export class AgentBuildModule {}
