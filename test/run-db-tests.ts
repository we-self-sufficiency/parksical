import { spawnSync } from 'node:child_process';

const value = process.env.TEST_DATABASE_URL;
if (!value) throw new Error('TEST_DATABASE_URL is required for integration tests');
const url = new URL(value);
if (!decodeURIComponent(url.pathname).endsWith('_test')) throw new Error('Test database name must end with _test');
if (value === process.env.DATABASE_URL) throw new Error('TEST_DATABASE_URL must differ from application DATABASE_URL');
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=1', 'test-build/test/integration/database.test.js', 'test-build/test/integration/auth.test.js', 'test-build/test/integration/vehicle.test.js', 'test-build/test/integration/lots.test.js', 'test-build/test/integration/difficulty.test.js', 'test-build/test/integration/catalog.test.js', 'test-build/test/integration/reviews.test.js'], {
  stdio: 'inherit', env: { ...process.env, DATABASE_URL: value, NODE_ENV: 'test' },
});
process.exitCode = result.status ?? 1;
