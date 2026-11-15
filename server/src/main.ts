import 'dotenv/config';
import { createApp } from './app.js';
import { readConfig } from './config.js';

async function main() {
  const config = readConfig();
  const app = await createApp(config);
  await app.listen(config.port, '0.0.0.0');
  let shuttingDown = false;
  const stop = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const deadline = setTimeout(() => process.exit(1), config.shutdownTimeoutMs);
    deadline.unref();
    void app.close().then(() => { clearTimeout(deadline); process.exitCode = 0; }).catch(() => process.exit(1));
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

void main().catch(() => {
  // Configuration/database exceptions can contain credentials; never print their object or stack.
  console.error(JSON.stringify({ event: 'startup_failed' }));
  process.exitCode = 1;
});
