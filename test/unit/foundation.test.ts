import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ValidationPipe } from '@nestjs/common';
import { IsString } from 'class-validator';
import { createApp } from '../../src/app.js';
import { readConfig } from '../../src/config.js';
import { DatabaseService } from '../../src/database.service.js';

const env = { DATABASE_URL: 'postgresql://unused:unused@127.0.0.1:1/foundation_test', NODE_ENV: 'test' };

test('invalid settings fail without echoing database credentials', () => {
  for (const data of [{}, { DATABASE_URL: 'credential-secret' }, { ...env, PORT: '0' }, { ...env, PORT: '3.1' }, { ...env, NODE_ENV: 'staging' }, { ...env, REAL_PAYMENTS_ENABLED: 'true' }]) {
    assert.throws(() => readConfig(data), error => error instanceof Error && !error.message.includes('credential-secret'));
  }
  assert.equal(readConfig(env).port, 3000);
});

test('validation rejects unknown fields and missing required DTO fields', async () => {
  class Input { @IsString() name!: string; }
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  await assert.rejects(pipe.transform({ name: 'ok', rawSignals: [1] }, { type: 'body', metatype: Input }));
  await assert.rejects(pipe.transform({}, { type: 'body', metatype: Input }));
  assert.equal((await pipe.transform({ name: 'ok' }, { type: 'body', metatype: Input }) as Input).name, 'ok');
});

test('HTTP liveness/readiness, safe errors, request IDs, body limits and log allowlist', async () => {
  const records: Record<string, string | number>[] = [];
  const app = await createApp(readConfig(env), record => records.push(record));
  const db = app.get(DatabaseService);
  let queries = 0;
  db.isReady = async () => { queries++; return false; };
  await app.listen(0, '127.0.0.1');
  const base = await app.getUrl();
  try {
    const live = await fetch(base + '/api/v1/health/live', { headers: { 'X-Request-Id': 'req_test_1' } });
    assert.equal(live.status, 200);
    assert.equal(live.headers.get('X-Request-Id'), 'req_test_1');
    assert.equal(queries, 0);
    const ready = await fetch(base + '/api/v1/health/ready');
    assert.equal(ready.status, 503);
    assert.equal(queries, 1);
    const error = await ready.json() as { error: { code: string; requestId: string; retryable: boolean } };
    assert.equal(error.error.code, 'DEPENDENCY_UNAVAILABLE');
    assert.equal(error.error.retryable, true);
    assert.equal(error.error.requestId, ready.headers.get('X-Request-Id'));
    const secret = 'never-log-this-private-token';
    const missing = await fetch(base + '/p/' + secret + '?lat=private', { headers: { authorization: secret, 'X-Request-Id': '!invalid!' } });
    assert.equal(missing.status, 404);
    assert.match(missing.headers.get('X-Request-Id') ?? '', /^[a-f0-9-]{36}$/);
    const malformed = await fetch(base + '/missing', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"secret":' });
    assert.equal(malformed.status, 400);
    const large = await fetch(base + '/missing', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ payload: secret.repeat(4000) }) });
    assert.equal(large.status, 413);
    const spec = await fetch(base + '/api/v1/openapi.json');
    assert.equal(spec.status, 200);
    assert.equal(spec.headers.get('X-Contract-Status'), 'design-only');
    assert.equal((await spec.json() as { openapi: string }).openapi, '3.1.1');
    assert.ok(records.length >= 6);
    assert.ok(!JSON.stringify(records).includes(secret));
    assert.ok(!JSON.stringify(records).includes('private'));
    assert.ok(records.every(r => Object.keys(r).sort().join() === 'durationMs,event,method,requestId,status'));
  } finally { await app.close(); }
});
