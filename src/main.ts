import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule);

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

  // Configure API prefix based on environment
  const nodeEnv = process.env.NODE_ENV || 'development';
  const isDevelopment = nodeEnv === 'development';

  // API_PREFIX: explicit override, or smart default based on NODE_ENV
  // Development: no prefix (routes at /)
  // Production: 'api' prefix (routes at /api/*)
  const apiPrefix = process.env.API_PREFIX !== undefined
    ? process.env.API_PREFIX
    : (isDevelopment ? '' : 'api');

  if (apiPrefix) {
    // Exclude /internal routes from the global prefix
    app.setGlobalPrefix(apiPrefix, {
      exclude: ['/internal{,/*}'],
    });
    logger.log(`🔧 API prefix enabled: /${apiPrefix}`);
  } else {
    logger.log(`🔧 API prefix disabled (development mode)`);
  }

  // Configure CORS
  const corsOrigin = process.env.CORS_ORIGIN || (isDevelopment ? '*' : process.env.PUBLIC_SERVER_URL);
  app.enableCors({
    origin: corsOrigin,
    credentials: true,
  });
  logger.log(`🌐 CORS enabled for: ${corsOrigin}`);

  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');

  const baseUrl = apiPrefix ? `http://localhost:${port}/${apiPrefix}` : `http://localhost:${port}`;

  logger.log(`🚀 Session Management Server running on http://0.0.0.0:${port}`);
  logger.log(`📦 Environment: ${nodeEnv}`);
  logger.log(`📊 Health check: ${baseUrl}/health`);
  logger.log(`📁 Projects API: ${baseUrl}/projects`);
  logger.log(`📱 Network info: http://localhost:${port}/network-info`);
  logger.log(`🔒 Internal APIs: http://localhost:${port}/internal/* (no prefix)`);
}

bootstrap();
