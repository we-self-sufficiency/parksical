import 'reflect-metadata';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Module, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { APP_CONFIG, type AppConfig } from './config.js';
import { DatabaseService } from './database.service.js';
import { HealthController } from './health.controller.js';
import { defaultLogSink, requestContext, SafeExceptionFilter, type LogSink } from './http.js';

@Module({})
class AppModule {}

export async function createApp(config: AppConfig, sink: LogSink = defaultLogSink) {
  const app = await NestFactory.create({
    module: AppModule,
    controllers: [HealthController],
    providers: [{ provide: APP_CONFIG, useValue: config }, DatabaseService],
  }, { logger: false, bodyParser: false, abortOnError: false });
  app.use(requestContext(sink));
  app.use(json({ limit: '64kb' }));
  app.use(urlencoded({ extended: false, limit: '64kb' }));
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, validationError: { target: false, value: false } }));
  app.useGlobalFilters(new SafeExceptionFilter());
  // This is the reviewed design contract, not Swagger generated from unimplemented controllers.
  const contract = await readFile(resolve('docs/openapi.json'), 'utf8');
  app.getHttpAdapter().get('/api/v1/openapi.json', (_req: unknown, res: import('express').Response) => {
    res.setHeader('X-Contract-Status', 'design-only');
    res.type('application/json').send(contract);
  });
  return app;
}
