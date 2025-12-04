import { Module, forwardRef } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AgentServerService } from './agent-server.service';
import { AgentGrpcController } from './agent-grpc.controller';
import { SessionOrchestratorService } from './session-orchestrator.service';
import { AgentHealthMonitorService } from './agent-health-monitor.service';
import { PrismaModule } from '../prisma/prisma.module';
import { SessionsModule } from '../sessions/sessions.module';

/**
 * AgentServerModule - gRPC server module for agent health checks.
 *
 * NOTE: In the new architecture, agents connect directly to LiveKit rooms
 * and communicate with STT/TTS services via gRPC. This module is being
 * simplified to only handle:
 * - Agent health monitoring
 * - Session orchestration state tracking
 *
 * The actual audio/text flow is now handled by the Agent SDK.
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
    SessionOrchestratorService,
    AgentHealthMonitorService,
  ],
  exports: [
    AgentServerService,
    SessionOrchestratorService,
    AgentHealthMonitorService,
  ],
})
export class AgentServerModule {}
