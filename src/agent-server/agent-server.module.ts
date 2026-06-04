import { Module, forwardRef } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AgentServerService } from './agent-server.service';
import { AgentGrpcController } from './agent-grpc.controller';
import { AgentHealthMonitorService } from './agent-health-monitor.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SessionsModule } from '../sessions/sessions.module';

/**
 * AgentServerModule - gRPC server module for agent health checks.
 *
 * NOTE: In the new architecture, agents connect directly to LiveKit rooms
 * and communicate with STT/TTS services via gRPC. This module now only handles
 * agent health monitoring and the gRPC session stream (start/end, interrupt,
 * health checks). The actual audio/text flow — including text barge-in (#278) —
 * is handled by the Agent SDK in the agent process.
 */
@Module({
  imports: [
    PrismaModule,
    EventEmitterModule.forRoot(),
    forwardRef(() => SessionsModule),
  ],
  controllers: [AgentGrpcController],
  providers: [
    AgentServerService,
    AgentHealthMonitorService,
  ],
  exports: [
    AgentServerService,
    AgentHealthMonitorService,
  ],
})
export class AgentServerModule {}
