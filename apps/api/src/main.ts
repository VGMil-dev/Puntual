import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { StructuredLoggerService } from './infrastructure/logging/structured-logger.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });

  const structuredLogger = app.get(StructuredLoggerService);
  app.useLogger(structuredLogger);
  app.enableShutdownHooks();

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = process.env.PORT || 3000;
  await app.listen(port);
  structuredLogger.log(`Puntual API running on http://localhost:${port}`, 'Bootstrap');
}

bootstrap();
