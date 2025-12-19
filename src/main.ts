import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { MicroserviceOptions, Transport } from '@nestjs/microservices';
import { join } from 'path';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule);

  // Determine proto path
  // In Docker: __dirname is /app/dist/src, proto files are at /app/dist/proto (../proto)
  // In local dev: __dirname is <project>/dist/src, proto files are at <project>/proto (../../proto)
  // Use PROTO_PATH env var if set, otherwise check for Docker path first, then local path
  const dockerProtoPath = join(__dirname, '../proto');
  const localProtoPath = join(__dirname, '../../proto');
  const protoDir =
    process.env.PROTO_PATH ||
    (require('fs').existsSync(join(dockerProtoPath, 'agent.proto'))
      ? dockerProtoPath
      : localProtoPath);

  // Add gRPC microservice for agent connections and state machine
  // Both services run on the same port - gRPC multiplexes by package name
  const grpcPort = process.env.GRPC_PORT || '50051';
  app.connectMicroservice<MicroserviceOptions>({
    transport: Transport.GRPC,
    options: {
      package: ['stella.agent.v1', 'stella.statemachine.v1'],
      protoPath: [
        join(protoDir, 'agent.proto'),
        join(protoDir, 'state_machine.proto'),
      ],
      url: `0.0.0.0:${grpcPort}`,
    },
  });
  logger.log(`🔌 gRPC server configured on port ${grpcPort} (AgentService + StateMachineService)`);

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  // Global exception filter
  app.useGlobalFilters(new AllExceptionsFilter());

  // No API prefix - all routes are at root level (/, /auth/*, /projects/*, etc.)
  // Internal routes (/internal/*) are at root level alongside public routes
  const nodeEnv = process.env.NODE_ENV || 'development';
  logger.log(`🔧 API prefix disabled - all routes at root level`);

  // Configure CORS
  const isDevelopment = nodeEnv === 'development';
  const corsOrigin = process.env.CORS_ORIGIN || (isDevelopment ? '*' : process.env.PUBLIC_FRONTEND_URL);
  app.enableCors({
    origin: corsOrigin,
    credentials: true,
  });
  logger.log(`🌐 CORS enabled for: ${corsOrigin}`);

  const port = process.env.PORT || 3000;

  // Start all microservices (gRPC)
  await app.startAllMicroservices();

  await app.listen(port, '0.0.0.0');

  const baseUrl = `http://localhost:${port}`;

  logger.log(`🚀 Session Management Server running on http://0.0.0.0:${port}`);
  logger.log(`📦 Environment: ${nodeEnv}`);
  logger.log(`📊 Health check: ${baseUrl}/health`);
  logger.log(`📁 Projects API: ${baseUrl}/projects`);
  logger.log(`📱 Network info: http://localhost:${port}/network-info`);
  logger.log(`🔒 Internal APIs: http://localhost:${port}/internal/* (no prefix)`);
}

bootstrap();
