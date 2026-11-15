import { Controller,Get,Query,Res } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import type { Response } from 'express';
import { ApiError } from '../api-error.js';
import { QrService } from './qr.service.js';
@Controller('p')
export class QrPageController {
  constructor(private readonly qr:QrService){}
  private async asset(file:string,type:string,query:Record<string,unknown>,res:Response){
    this.qr.origin();if(Object.keys(query).length)throw new ApiError(400,'INVALID_REQUEST');
    res.type(type).send(await readFile('public/qr/'+file,'utf8'));
  }
  @Get()
  async page(@Query()q:Record<string,unknown>,@Res()res:Response){await this.asset('index.html','html',q,res);}
  @Get('app.js')
  async script(@Query()q:Record<string,unknown>,@Res()res:Response){await this.asset('app.js','application/javascript',q,res);}
  @Get('style.css')
  async style(@Query()q:Record<string,unknown>,@Res()res:Response){await this.asset('style.css','text/css',q,res);}
}
