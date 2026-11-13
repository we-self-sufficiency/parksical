export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  shutdownTimeoutMs: number;
  devAuthEnabled: boolean;
  devReviewsEnabled: boolean;
  devAuthSecret?: string;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv)) throw new Error('Invalid NODE_ENV');
  const port = Number(env.PORT ?? '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  if (!env.DATABASE_URL) throw new Error('Missing DATABASE_URL');
  let url: URL;
  try { url = new URL(env.DATABASE_URL); } catch { throw new Error('Invalid DATABASE_URL'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname.slice(1)) {
    throw new Error('Invalid DATABASE_URL');
  }
  // No feature needing a user policy is activated by this foundation.
  for (const name of ['RAW_SIGNALS_ENABLED', 'DRIVING_SUMMARY_ENABLED', 'REAL_PAYMENTS_ENABLED', 'REAL_REVIEWS_ENABLED']) {
    if (env[name] !== undefined && env[name] !== 'false') throw new Error(`Unsupported ${name}`);
  }
  if (env.DEV_AUTH_ENABLED !== undefined && !['true', 'false'].includes(env.DEV_AUTH_ENABLED)) throw new Error('Invalid DEV_AUTH_ENABLED');
  const devAuthEnabled = env.DEV_AUTH_ENABLED === 'true';
  if (devAuthEnabled && (nodeEnv === 'production' || (env.DEV_AUTH_SECRET?.length ?? 0) < 32)) throw new Error('Development authentication is not allowed or missing configuration');
  if (env.DEV_REVIEWS_ENABLED !== undefined && !['true','false'].includes(env.DEV_REVIEWS_ENABLED)) throw new Error('Invalid DEV_REVIEWS_ENABLED');
  const devReviewsEnabled=env.DEV_REVIEWS_ENABLED==='true';
  if(devReviewsEnabled && (nodeEnv==='production' || !devAuthEnabled)) throw new Error('Synthetic reviews require non-production development authentication');
  return { devReviewsEnabled, nodeEnv: nodeEnv as AppConfig['nodeEnv'], port, databaseUrl: env.DATABASE_URL, shutdownTimeoutMs: 10000, devAuthEnabled, devAuthSecret: env.DEV_AUTH_SECRET };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
