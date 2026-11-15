import 'dotenv/config';
import { readConfig } from '../config.js';
import { DatabaseService } from '../database.service.js';
import { seedSyntheticLot } from './seed-store.js';

let db: DatabaseService | undefined;
try {
  db = new DatabaseService(readConfig());
  const lot = await seedSyntheticLot(db.client, process.env);
  console.log(JSON.stringify({ event: 'synthetic_lot_seeded', id: lot.id, version: lot.version, source: 'SYNTHETIC' }));
} catch {
  // Do not print credentials, database errors or full validation input.
  console.error('Synthetic lot seed failed. Check explicit opt-in, migration and seed divergence.');
  process.exitCode = 1;
} finally { await db?.onModuleDestroy(); }
