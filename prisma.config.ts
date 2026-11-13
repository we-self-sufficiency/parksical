import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Generate needs no live database or real credential; migration commands must set DATABASE_URL.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? 'postgresql://invalid:invalid@127.0.0.1:1/unconfigured' },
});
