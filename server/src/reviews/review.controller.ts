import { Body,Controller,Delete,Get,Headers,Param,ParseIntPipe,ParseUUIDPipe,Post,Put,Query,Req,Res,UseGuards } from '@nestjs/common';
import { ApiError } from '../api-error.js';
import type { Response } from 'express';
import { AuthGuard,Roles,WebOnly,type AuthRequest } from '../auth/guards.js';
import { AuthService } from '../auth/auth.service.js';
import { AggregateQuery,ReviewCreateDto,ReviewLookupQuery,ReviewRebuildDto,ReviewUpdateDto,ReviewVersionDto } from './dto.js';
import { ReviewService } from './review.service.js';

@Controller() @UseGuards(AuthGuard)
export class ReviewController {
  constructor(private readonly reviews:ReviewService,private readonly auth:AuthService){}
  private async rate(req:AuthRequest,write:boolean){this.reviews.enabled();await this.auth.rate('review-'+(write?'write':'read'),req.principal.sessionId,write?100:300);}
  private receipt(result:{body:unknown;replayed:boolean},res:Response){if(result.replayed)res.setHeader('Idempotency-Replayed','true');return result.body;}
  @Post('reviews')
  async create(@Req()req:AuthRequest,@Headers('Idempotency-Key')key:string|undefined,@Body()dto:ReviewCreateDto,@Res({passthrough:true})res:Response){await this.rate(req,true);return this.receipt(await this.reviews.create(req.principal,key,dto),res);}
  @Get('reviews/me')
  async mine(@Req()req:AuthRequest,@Query()q:ReviewLookupQuery){await this.rate(req,false);return this.reviews.mine(req.principal,q.lotId,q.lotVersion);}
  @Get('reviews/:reviewId')
  async get(@Req()req:AuthRequest,@Param('reviewId',new ParseUUIDPipe())id:string){await this.rate(req,false);return this.reviews.get(req.principal,id);}
  @Put('reviews/:reviewId')
  async update(@Req()req:AuthRequest,@Param('reviewId',new ParseUUIDPipe())id:string,@Headers('Idempotency-Key')key:string|undefined,@Body()dto:ReviewUpdateDto,@Res({passthrough:true})res:Response){await this.rate(req,true);return this.receipt(await this.reviews.update(req.principal,id,key,dto),res);}
  @Delete('reviews/:reviewId')
  async remove(@Req()req:AuthRequest,@Param('reviewId',new ParseUUIDPipe())id:string,@Headers('Idempotency-Key')key:string|undefined,@Body()dto:ReviewVersionDto,@Res({passthrough:true})res:Response){await this.rate(req,true);return this.receipt(await this.reviews.update(req.principal,id,key,dto,true),res);}
  @Get('lots/:lotId/reviews/aggregate')
  async summary(@Req()req:AuthRequest,@Param('lotId',new ParseUUIDPipe())id:string,@Query()q:AggregateQuery){await this.rate(req,false);return this.reviews.summary(req.principal,id,q);}
  @Post('admin/lots/:lotId/revisions/:version/review-aggregate/rebuild') @Roles('ADMIN') @WebOnly()
  async rebuild(@Req()req:AuthRequest,@Param('lotId',new ParseUUIDPipe())id:string,@Param('version',new ParseIntPipe())version:number,@Headers('Idempotency-Key')key:string|undefined,@Body()dto:ReviewRebuildDto,@Res({passthrough:true})res:Response){await this.rate(req,true);if(!Number.isSafeInteger(version)||version<1||version>2147483647)throw new ApiError(400,'INVALID_LOT_VERSION');return this.receipt(await this.reviews.rebuild(req.principal,id,version,key,dto),res);}
}
