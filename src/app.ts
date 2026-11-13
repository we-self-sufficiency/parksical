import 'reflect-metadata';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { APP_CONFIG, type AppConfig } from './config.js';
import { DatabaseService } from './database.service.js';
import { HealthController } from './health.controller.js';
import { defaultLogSink, requestContext, SafeExceptionFilter, type LogSink } from './http.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthService } from './auth/auth.service.js';
import { AuthGuard } from './auth/guards.js';
import { DevelopmentLoginProvider, LOGIN_PROVIDER } from './auth/provider.js';
import { VehicleController } from './vehicle/vehicle.controller.js';
import { VehicleService } from './vehicle/vehicle.service.js';
import { ObjectValidationPipe } from './validation.js';
import { LotController } from './lots/lot.controller.js';
import { LotService } from './lots/lot.service.js';

@Module({})
class AppModule {}

export async function createApp(config: AppConfig, sink: LogSink = defaultLogSink) {
  const app = await NestFactory.create({
    module: AppModule,
    controllers: [HealthController, AuthController, VehicleController, LotController],
    providers: [{ provide: APP_CONFIG, useValue: config }, DatabaseService, AuthService, AuthGuard, VehicleService, LotService, { provide: LOGIN_PROVIDER, useClass: DevelopmentLoginProvider }],
  }, { logger: false, bodyParser: false, abortOnError: false });
  app.use(requestContext(sink));
  app.use(json({ limit: '64kb' }));
  app.use(urlencoded({ extended: false, limit: '64kb' }));
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ObjectValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, validationError: { target: false, value: false } }));
  app.useGlobalFilters(new SafeExceptionFilter());
  // This is the reviewed design contract, not Swagger generated from unimplemented controllers.
  const contract = await readFile(resolve('docs/openapi.json'), 'utf8');
  app.getHttpAdapter().get('/api/v1/openapi.json', (_req: unknown, res: import('express').Response) => {
    res.setHeader('X-Contract-Status', 'mixed');
    res.type('application/json').send(contract);
  });
  return app;
}
