import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { ProjectsModule } from './projects/projects.module';
import { SessionsModule } from './sessions/sessions.module';
import { AgentsModule } from './agents/agents.module';
import { LiveKitModule } from './livekit/livekit.module';
import { KubernetesModule } from './kubernetes/kubernetes.module';
import { MessageRecorderModule } from './message-recorder/message-recorder.module';
import { AgentServerModule } from './agent-server/agent-server.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { JwtAuthGuard } from './auth/guards/jwt-auth.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PrismaModule,
    AuthModule,
    ProjectsModule,
    SessionsModule,
    AgentsModule,
    LiveKitModule,
    KubernetesModule,
    MessageRecorderModule,
    AgentServerModule,
    WebhooksModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule {}
