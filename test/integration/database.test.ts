import 'reflect-metadata';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { Client } from 'pg';
import { createApp } from '../../src/app.js';
import { readConfig } from '../../src/config.js';
import { DatabaseService } from '../../src/database.service.js';

test('real PostgreSQL migration reapply, Prisma persistence, HTTP DB readiness and recovery', async () => {
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { stdio: 'pipe' });
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], { stdio: 'pipe' });
  execFileSync(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma', '--exit-code'], { stdio: 'pipe' });
  const app = await createApp(readConfig(), () => {});
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  const key = 'test_' + randomUUID();
  const db = app.get(DatabaseService);
  try {
    assert.equal((await fetch(base + '/api/v1/health/ready')).status, 200);
    await db.client.serviceMetadata.create({ data: { key, value: 'persisted' } });
    await db.client.$disconnect();
    assert.equal((await db.client.serviceMetadata.findUniqueOrThrow({ where: { key } })).value, 'persisted');
    // Independently check PostgreSQL itself; no mocked database in this suite.
    const sql = new Client({ connectionString: process.env.DATABASE_URL });
    await sql.connect();
    const rows = await sql.query('SELECT value FROM "ServiceMetadata" WHERE key=$1', [key]);
    assert.equal(rows.rows[0]?.value, 'persisted');
    await sql.end();
    const badConfig = { ...readConfig(), databaseUrl: 'postgresql://unused:unused@127.0.0.1:1/unavailable_test' };
    const down = await createApp(badConfig, () => {});
    await down.listen(0, '127.0.0.1');
    try {
      const url = await down.getUrl();
      assert.equal((await fetch(url + '/api/v1/health/live')).status, 200);
      assert.equal((await fetch(url + '/api/v1/health/ready')).status, 503);
    } finally { await down.close(); }
  } finally {
    await db.client.serviceMetadata.deleteMany({ where: { key } });
    await app.close();
  }
});
