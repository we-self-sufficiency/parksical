import { Body,Controller,Delete,Get,Headers,Param,ParseUUIDPipe,Patch,Post,Query,Req,Res,UseGuards } from '@nestjs/common';
import { ApiError } from '../api-error.js';
import type { Response } from 'express';
import { AuthGuard,type AuthRequest } from '../auth/guards.js';
import { AuthService } from '../auth/auth.service.js';
import { LocationService } from './location.service.js';
import { LocationCreateDto,LocationHistoryQuery,LocationPageQuery,LocationPatchDto,LocationPhotoDto,LocationVersionDto } from './dto.js';
@Controller('parked-locations') @UseGuards(AuthGuard)
export class LocationController {
  constructor(private readonly locations:LocationService,private readonly auth:AuthService){}
  private async rate(req:AuthRequest,write=false){this.locations.enabled();await this.auth.rate('locations-'+(write?'write':'read'),req.principal.userId,write?100:300);}
  private noQuery(query:Record<string,unknown>){if(Object.keys(query).length)throw new ApiError(400,'INVALID_REQUEST');}
  private reply(result:{body:unknown;replayed:boolean},res:Response){if(result.replayed)res.setHeader('Idempotency-Replayed','true');return result.body;}
  @Post()
  async create(@Req()req:AuthRequest,@Headers('Idempotency-Key')key:string|undefined,@Body()dto:LocationCreateDto,@Res({passthrough:true})res:Response){await this.rate(req,true);return this.reply(await this.locations.create(req.principal,key,dto),res);}
  @Get()
  async list(@Req()req:AuthRequest,@Query()q:LocationPageQuery){await this.rate(req);return this.locations.list(req.principal,q);}
  @Get('current')
  async current(@Req()req:AuthRequest,@Query()q:Record<string,unknown>){this.noQuery(q);await this.rate(req);return this.locations.current(req.principal);}
  @Get(':locationId')
  async get(@Req()req:AuthRequest,@Param('locationId',new ParseUUIDPipe())id:string,@Query()q:Record<string,unknown>){this.noQuery(q);await this.rate(req);return this.locations.get(req.principal,id);}
  @Get(':locationId/history')
  async history(@Req()req:AuthRequest,@Param('locationId',new ParseUUIDPipe())id:string,@Query()q:LocationHistoryQuery){await this.rate(req);return this.locations.history(req.principal,id,q);}
  @Patch(':locationId')
  async patch(@Req()req:AuthRequest,@Param('locationId',new ParseUUIDPipe())id:string,@Headers('Idempotency-Key')key:string|undefined,@Body()dto:LocationPatchDto,@Res({passthrough:true})res:Response){await this.rate(req,true);return this.reply(await this.locations.patch(req.principal,id,key,dto),res);}
  @Delete(':locationId')
  async remove(@Req()req:AuthRequest,@Param('locationId',new ParseUUIDPipe())id:string,@Headers('Idempotency-Key')key:string|undefined,@Body()dto:LocationVersionDto,@Res({passthrough:true})res:Response){await this.rate(req,true);return this.reply(await this.locations.remove(req.principal,id,key,dto),res);}
  @Post(':locationId/photos')
  async addPhoto(@Req()req:AuthRequest,@Param('locationId',new ParseUUIDPipe())id:string,@Headers('Idempotency-Key')key:string|undefined,@Body()dto:LocationPhotoDto,@Res({passthrough:true})res:Response){await this.rate(req,true);return this.reply(await this.locations.addPhoto(req.principal,id,key,dto),res);}
  @Get(':locationId/photos/:photoId')
  async photo(@Req()req:AuthRequest,@Param('locationId',new ParseUUIDPipe())id:string,@Param('photoId',new ParseUUIDPipe())photoId:string,@Query()q:Record<string,unknown>,@Res()res:Response){this.noQuery(q);await this.rate(req);const data=await this.locations.photo(req.principal,id,photoId);res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Disposition','inline; filename="parking-photo.jpg"');res.type('image/jpeg').send(data);}
  @Delete(':locationId/photos/:photoId')
  async removePhoto(@Req()req:AuthRequest,@Param('locationId',new ParseUUIDPipe())id:string,@Param('photoId',new ParseUUIDPipe())photoId:string,@Headers('Idempotency-Key')key:string|undefined,@Body()dto:LocationVersionDto,@Res({passthrough:true})res:Response){await this.rate(req,true);return this.reply(await this.locations.removePhoto(req.principal,id,photoId,key,dto),res);}
}
