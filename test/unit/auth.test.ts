import 'reflect-metadata';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DevelopmentLoginProvider } from '../../src/auth/provider.js';
import { readConfig } from '../../src/config.js';

const database = { DATABASE_URL: 'postgresql://test@127.0.0.1:1/parksical_test' };
test('development auth requires explicit enablement plus a secret and fails closed in production', async () => {
  for (const env of [
    { ...database, NODE_ENV: 'production', DEV_AUTH_ENABLED: 'true', DEV_AUTH_SECRET: 'x'.repeat(40) },
    { ...database, DEV_AUTH_ENABLED: 'true', DEV_AUTH_SECRET: 'short' },
    { ...database, DEV_AUTH_ENABLED: 'yes' },
  ]) assert.throws(() => readConfig(env));
  const provider = new DevelopmentLoginProvider(readConfig(database));
  await assert.rejects(provider.authenticate('subject', 'anything'));
  const enabled = new DevelopmentLoginProvider(readConfig({ ...database, DEV_AUTH_ENABLED: 'true', DEV_AUTH_SECRET: 'x'.repeat(40) }));
  await assert.rejects(enabled.authenticate('subject', 'wrong'));
  assert.deepEqual(await enabled.authenticate('subject', 'x'.repeat(40)), { provider: 'DEV', subject: 'subject' });
});
