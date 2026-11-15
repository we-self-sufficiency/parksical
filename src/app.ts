import 'reflect-metadata';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Module,RequestMethod } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded,type Request,type Response,type NextFunction } from 'express';
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
import { DifficultyController } from './difficulty/difficulty.controller.js';
import { QrOwnerController,QrPhoneController } from './qr/qr.controller.js';
import { QrPageController } from './qr/page.controller.js';
import { QrService } from './qr/qr.service.js';
import { LocationController } from './locations/location.controller.js';
import { LocationService } from './locations/location.service.js';
import { DatabasePhotoStore,PRIVATE_PHOTO_STORE } from './locations/photos.js';
import { ReviewController } from './reviews/review.controller.js';
import { ReviewService } from './reviews/review.service.js';
import { CatalogController } from './lots/catalog.controller.js';
import { CatalogService } from './lots/catalog.service.js';
import { DifficultyService } from './difficulty/difficulty.service.js';

import { RankingController } from './rankings/ranking.controller.js';
import { RankingService } from './rankings/ranking.service.js';
import { ReservationController } from './reservations/reservation.controller.js';
import { ReservationService } from './reservations/reservation.service.js';
import { RESERVATION_PAYMENTS, SandboxReservationPayments } from './reservations/payment-port.js';
import { PracticeController } from './practice/practice.controller.js';
import { PracticeService } from './practice/practice.service.js';
import { MissionController } from './missions/mission.controller.js';
import { MissionService } from './missions/mission.service.js';
import { PaymentController,PaymentWebhookController } from './payments/payment.controller.js';
import { PaymentService } from './payments/payment.service.js';
import { PAYMENT_PROVIDER,SandboxPaymentProvider } from './payments/provider.js';

@Module({})
class AppModule {}

export async function createApp(config: AppConfig, sink: LogSink = defaultLogSink) {
  const app = await NestFactory.create({
    module: AppModule,
    controllers: [PaymentController,PaymentWebhookController,RankingController, ReservationController, PracticeController, MissionController, HealthController, AuthController, VehicleController, LotController, DifficultyController, CatalogController, ReviewController, LocationController, QrOwnerController, QrPhoneController, QrPageController],
    providers: [{ provide: APP_CONFIG, useValue: config }, PaymentService,{provide:PAYMENT_PROVIDER,useClass:SandboxPaymentProvider},DatabaseService, AuthService, AuthGuard, RankingService, ReservationService, { provide: RESERVATION_PAYMENTS, useClass: SandboxReservationPayments }, PracticeService, MissionService, VehicleService, LotService, DifficultyService, CatalogService, ReviewService, LocationService, QrService, { provide: PRIVATE_PHOTO_STORE, useClass: DatabasePhotoStore }, { provide: LOGIN_PROVIDER, useClass: DevelopmentLoginProvider }],
  }, { logger: false, bodyParser: false, abortOnError: false });
  app.use(requestContext(sink));
  const ordinaryJson=json({limit:'64kb',verify:(req,_res,buf)=>{if((req as Request).path==='/api/v1/payments/webhooks/sandbox')(req as Request & {rawBody?:Buffer}).rawBody=Buffer.from(buf);}}),photoJson=json({limit:'3mb'});
  app.use((req:Request,res:Response,next:NextFunction)=>req.method==='POST' && /^\/api\/v1\/parked-locations\/[0-9a-f-]{36}\/photos$/i.test(req.path)?photoJson(req,res,next):ordinaryJson(req,res,next));
  app.use(urlencoded({ extended: false, limit: '64kb' }));
  app.setGlobalPrefix('api/v1',{exclude:['p','p/app.js','p/style.css'].map(path=>({path,method:RequestMethod.GET}))});
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
