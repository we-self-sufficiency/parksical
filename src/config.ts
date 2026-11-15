export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  databaseUrl: string;
  shutdownTimeoutMs: number;
  devAuthEnabled: boolean;
  devReviewsEnabled: boolean;
  devLocationsEnabled: boolean;
  devQrEnabled: boolean;
  devMissionsEnabled: boolean;
  devReservationsEnabled: boolean;
  qrPublicOrigin?: string;
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
  for (const name of ['RAW_SIGNALS_ENABLED', 'DRIVING_SUMMARY_ENABLED', 'REAL_PAYMENTS_ENABLED', 'REAL_REVIEWS_ENABLED', 'REAL_LOCATIONS_ENABLED', 'REAL_QR_ENABLED', 'REAL_MISSIONS_ENABLED', 'REAL_RESERVATIONS_ENABLED']) {
    if (env[name] !== undefined && env[name] !== 'false') throw new Error(`Unsupported ${name}`);
  }
  if (env.DEV_AUTH_ENABLED !== undefined && !['true', 'false'].includes(env.DEV_AUTH_ENABLED)) throw new Error('Invalid DEV_AUTH_ENABLED');
  const devAuthEnabled = env.DEV_AUTH_ENABLED === 'true';
  if (devAuthEnabled && (nodeEnv === 'production' || (env.DEV_AUTH_SECRET?.length ?? 0) < 32)) throw new Error('Development authentication is not allowed or missing configuration');
  if (env.DEV_REVIEWS_ENABLED !== undefined && !['true','false'].includes(env.DEV_REVIEWS_ENABLED)) throw new Error('Invalid DEV_REVIEWS_ENABLED');
  const devReviewsEnabled=env.DEV_REVIEWS_ENABLED==='true';
  if(devReviewsEnabled && (nodeEnv==='production' || !devAuthEnabled)) throw new Error('Synthetic reviews require non-production development authentication');
  if(env.DEV_LOCATIONS_ENABLED!==undefined && !['true','false'].includes(env.DEV_LOCATIONS_ENABLED))throw new Error('Invalid DEV_LOCATIONS_ENABLED');
  const devLocationsEnabled=env.DEV_LOCATIONS_ENABLED==='true';
  if(devLocationsEnabled && (nodeEnv==='production' || !devAuthEnabled))throw new Error('Private development locations require non-production development authentication');
  if(env.DEV_QR_ENABLED!==undefined && !['true','false'].includes(env.DEV_QR_ENABLED))throw new Error('Invalid DEV_QR_ENABLED');
  const devQrEnabled=env.DEV_QR_ENABLED==='true';
  let qrPublicOrigin:string|undefined;
  if(env.QR_PUBLIC_ORIGIN){
    let origin:URL;
    try{origin=new URL(env.QR_PUBLIC_ORIGIN);}catch{throw new Error('Invalid QR_PUBLIC_ORIGIN');}
    if(origin.origin!==env.QR_PUBLIC_ORIGIN || origin.username || origin.password || (origin.protocol!=='https:' && !(origin.protocol==='http:' && ['127.0.0.1','localhost','[::1]'].includes(origin.hostname))))throw new Error('Invalid QR_PUBLIC_ORIGIN');
    qrPublicOrigin=origin.origin;
  }
  if(devQrEnabled && (nodeEnv==='production' || !devAuthEnabled || !devLocationsEnabled || !qrPublicOrigin))throw new Error('Development QR requires synthetic locations, authentication and explicit origin');
  if(env.DEV_MISSIONS_ENABLED!==undefined && !['true','false'].includes(env.DEV_MISSIONS_ENABLED))throw new Error('Invalid DEV_MISSIONS_ENABLED');
  const devMissionsEnabled=env.DEV_MISSIONS_ENABLED==='true';
  if(devMissionsEnabled && (nodeEnv==='production' || !devAuthEnabled))throw new Error('Synthetic missions require non-production development authentication');
  if(env.DEV_RESERVATIONS_ENABLED!==undefined && !['true','false'].includes(env.DEV_RESERVATIONS_ENABLED))throw new Error('Invalid DEV_RESERVATIONS_ENABLED');
  const devReservationsEnabled=env.DEV_RESERVATIONS_ENABLED==='true';
  if(devReservationsEnabled && (nodeEnv==='production' || !devAuthEnabled))throw new Error('Synthetic reservations require non-production development authentication');
  return { devReservationsEnabled, devMissionsEnabled, devQrEnabled, qrPublicOrigin, devLocationsEnabled, devReviewsEnabled, nodeEnv: nodeEnv as AppConfig['nodeEnv'], port, databaseUrl: env.DATABASE_URL, shutdownTimeoutMs: 10000, devAuthEnabled, devAuthSecret: env.DEV_AUTH_SECRET };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
