import { Body,Controller,Get,Headers,Param,ParseUUIDPipe,Post,Query,Req,Res,UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiError } from '../api-error.js';
import { AuthGuard,type AuthRequest,VehicleOnly } from '../auth/guards.js';
import { AuthService } from '../auth/auth.service.js';
import { MissionService } from './mission.service.js';
import { MissionQuery,RunCreateDto,RunPageQuery,RunResultDto } from './dto.js';
@Controller() @UseGuards(AuthGuard)
export class MissionController {
  constructor(private readonly missions:MissionService,private readonly auth:AuthService){}
  private async rate(req:AuthRequest,write=false){this.missions.enabled();await this.auth.rate('missions-'+(write?'write':'read'),req.principal.userId,write?100:300);}
  private noQuery(q:Record<string,unknown>){if(Object.keys(q).length)throw new ApiError(400,'INVALID_REQUEST');}
  private reply(r:{body:unknown;replayed:boolean},res:Response){if(r.replayed)res.setHeader('Idempotency-Replayed','true');return r.body;}
  @Get('missions')
  async catalog(@Req()r:AuthRequest,@Query()q:MissionQuery){await this.rate(r);return this.missions.missions(r.principal,q);}
  @Post('runs') @VehicleOnly()
  async create(@Req()r:AuthRequest,@Query()q:Record<string,unknown>,@Headers('Idempotency-Key')key:string|undefined,@Body()dto:RunCreateDto,@Res({passthrough:true})res:Response){this.noQuery(q);await this.rate(r,true);return this.reply(await this.missions.create(r.principal,key,dto),res);}
  @Get('runs')
  async list(@Req()r:AuthRequest,@Query()q:RunPageQuery){await this.rate(r);return this.missions.list(r.principal,q);}
  @Get('runs/:runId')
  async get(@Req()r:AuthRequest,@Param('runId',new ParseUUIDPipe())id:string,@Query()q:Record<string,unknown>){this.noQuery(q);await this.rate(r);return this.missions.get(r.principal,id);}
  @Post('runs/:runId/result') @VehicleOnly()
  async result(@Req()r:AuthRequest,@Param('runId',new ParseUUIDPipe())id:string,@Query()q:Record<string,unknown>,@Headers('Idempotency-Key')key:string|undefined,@Body()dto:RunResultDto,@Res({passthrough:true})res:Response){this.noQuery(q);await this.rate(r,true);return this.reply(await this.missions.result(r.principal,id,key,dto),res);}
}
