import { readFile } from 'node:fs/promises';
import { plainToInstance } from 'class-transformer';
import { validateOrReject } from 'class-validator';
import type { PrismaClient } from '../generated/prisma/client.js';
import { fingerprint } from '../vehicle/normalization.js';
import { LotCreateDto } from './dto.js';
import { lotView, writeRevision } from './store.js';
import { validateSnapshot } from './validation.js';

export const SYNTHETIC_LOT_ID = '66666666-6666-4666-8666-666666666666';
export async function seedSyntheticLot(client: PrismaClient, env: NodeJS.ProcessEnv) {
  if (!['development', 'test'].includes(env.NODE_ENV ?? '') || env.ALLOW_SYNTHETIC_SEED !== 'true') throw new Error('SYNTHETIC_SEED_DISABLED');
  const raw: unknown = JSON.parse(await readFile('fixtures/lots/one-synthetic-lot.json', 'utf8'));
  const dto = plainToInstance(LotCreateDto, raw);
  await validateOrReject(dto, { whitelist: true, forbidNonWhitelisted: true, validationError: { target: false, value: false } });
  validateSnapshot(dto.snapshot);
  return client.$transaction(async tx => {
    const lock = 'lot-code:' + dto.code;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))`;
    const existing = await tx.parkingLot.findUnique({ where: { code: dto.code } });
    if (existing) {
      if (existing.id !== SYNTHETIC_LOT_ID) throw new Error('SYNTHETIC_SEED_ID_CONFLICT');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'lot:' + existing.id}, 0))`;
      const latest = await tx.parkingLot.findUniqueOrThrow({ where: { id: existing.id } });
      const revision = await tx.lotRevision.findUniqueOrThrow({ where: { lotId_version: { lotId: existing.id, version: latest.currentVersion } } });
      if (fingerprint(revision.snapshot) !== fingerprint(dto.snapshot)) throw new Error('SYNTHETIC_SEED_DIVERGED');
      return lotView(latest, revision);
    }
    const lot = await tx.parkingLot.create({ data: { id: SYNTHETIC_LOT_ID, code: dto.code, currentVersion: 1 } });
    const revision = await writeRevision(tx, lot.id, 1, dto.snapshot);
    return lotView(lot, revision);
  });
}
