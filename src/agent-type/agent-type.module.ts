import { Module } from '@nestjs/common'
import { AgentTypeService } from './agent-type.service'
import { PrismaModule } from '../prisma/prisma.module'

@Module({
  imports: [PrismaModule],
  providers: [AgentTypeService],
  exports: [AgentTypeService],
})
export class AgentTypeModule {}
