import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';
import { APP_CONFIG, type AppConfig } from './config.js';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly client: PrismaClient;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.client = new PrismaClient({
      // Prisma's timestamp parameters must be interpreted in UTC even on a KST database host.
      adapter: new PrismaPg({ connectionString: config.databaseUrl, options: '-c timezone=UTC', connectionTimeoutMillis: 1500, query_timeout: 1500, max: 5 }),
    });
  }

  async isReady(): Promise<boolean> {
    try { await this.client.serviceMetadata.count(); return true; } catch { return false; }
  }

  async onModuleDestroy(): Promise<void> { await this.client.$disconnect(); }
}
