import {Injectable} from '@nestjs/common';
import type {Prisma} from '../generated/prisma/client.js';
@Injectable()
export class RewardClock {async now(tx:Prisma.TransactionClient){const rows=await tx.$queryRaw<{ms:bigint}[]>`SELECT floor(extract(epoch FROM clock_timestamp())*1000)::bigint AS ms`;return new Date(Number(rows[0]!.ms));}}
