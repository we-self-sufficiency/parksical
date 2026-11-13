import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { DatabaseService } from '../database.service.js';
import { ApiError } from '../api-error.js';
import type { Prisma } from '../generated/prisma/client.js';
import { LOGIN_PROVIDER, type LoginProvider } from './provider.js';

type Tx = Prisma.TransactionClient;
export interface Principal {
  sessionId: string; userId: string; role: 'USER' | 'ADMIN'; kind: 'WEB' | 'VEHICLE'; installationId: string | null;
}
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const secret = () => randomBytes(32).toString('base64url');
const sameHash = (a: string, b: string) => timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));

@Injectable()
export class AuthService {
  constructor(
    private readonly database: DatabaseService,
    @Inject(LOGIN_PROVIDER) private readonly provider: LoginProvider,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private enabled() {
    if (!this.config.devAuthEnabled || this.config.nodeEnv === 'production') throw new ApiError(403, 'PROVIDER_NOT_CONFIGURED');
  }

  private async locked<T>(key: string, work: (tx: Tx) => Promise<T>) {
    return this.database.client.$transaction(async tx => {
      // All installation mutations share one key, including refresh and owner changes.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      return work(tx);
    }, { maxWait: 5000, timeout: 10000 });
  }

  async rate(scope: string, actor: string, limit: number) {
    this.enabled();
    const key = hash(scope + ':' + actor);
    const rows = await this.database.client.$queryRaw<{ count: number }[]>`
      INSERT INTO "AuthRateBucket" ("key", "windowStart", "count") VALUES (${key}, NOW(), 1)
      ON CONFLICT ("key") DO UPDATE SET
        "count" = CASE WHEN "AuthRateBucket"."windowStart" <= NOW() - INTERVAL '5 minutes' THEN 1 ELSE "AuthRateBucket"."count" + 1 END,
        "windowStart" = CASE WHEN "AuthRateBucket"."windowStart" <= NOW() - INTERVAL '5 minutes' THEN NOW() ELSE "AuthRateBucket"."windowStart" END
      RETURNING "count"`;
    if (!rows[0] || rows[0].count > limit) throw new ApiError(429, 'RATE_LIMITED', 300);
  }

  private async session(store: Pick<Tx, 'authSession'>, sessionId: string) {
    const row = await store.authSession.findUnique({ where: { id: sessionId }, include: { user: true, installation: true } });
    if (!row || row.revokedAt || row.refreshExpiresAt <= new Date() || row.provider !== 'DEV' ||
        !this.config.devAuthEnabled || this.config.nodeEnv === 'production') return null;
    if (row.kind === 'VEHICLE' && (!row.installation || row.installation.linkedUserId !== row.userId || row.installation.linkRevokedAt)) return null;
    return row;
  }

  async authenticate(token: string): Promise<Principal> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new ApiError(401, 'UNAUTHENTICATED');
    const candidate = await this.database.client.authSession.findUnique({ where: { accessHash: hash(token) } });
    const row = candidate && await this.session(this.database.client, candidate.id);
    if (!row || row.accessExpiresAt <= new Date() || !sameHash(row.accessHash, hash(token))) throw new ApiError(401, 'UNAUTHENTICATED');
    return { sessionId: row.id, userId: row.userId, role: row.user.role, kind: row.kind, installationId: row.installationId };
  }

  private async principal(tx: Tx, p: Principal, web = false) {
    const row = await this.session(tx, p.sessionId);
    if (!row || row.userId !== p.userId || row.accessExpiresAt <= new Date()) throw new ApiError(401, 'UNAUTHENTICATED');
    if (web && row.kind !== 'WEB') throw new ApiError(403, 'WEB_SESSION_REQUIRED');
    return row;
  }

  private sessionKey(row: { installationId: string | null; id: string }) {
    return row.installationId ? 'installation:' + row.installationId : 'session:' + row.id;
  }

  async forVehicle<T>(p: Principal, work: (tx: Tx) => Promise<T>): Promise<T> {
    if (p.kind !== 'VEHICLE' || !p.installationId) throw new ApiError(403, 'VEHICLE_SESSION_REQUIRED');
    return this.locked('installation:' + p.installationId, async tx => {
      const row = await this.principal(tx, p);
      if (row.kind !== 'VEHICLE' || row.installationId !== p.installationId) throw new ApiError(403, 'INSTALLATION_NOT_LINKED');
      return work(tx);
    });
  }

  private async issue(tx: Tx, userId: string, kind: 'WEB' | 'VEHICLE', installationId: string | null = null) {
    const accessToken = secret(), refreshToken = secret();
    const accessExpiresAt = new Date(Date.now() + 15 * 60_000);
    const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60_000);
    const row = await tx.authSession.create({ data: {
      userId, kind, installationId, provider: 'DEV', accessHash: hash(accessToken), accessExpiresAt, refreshExpiresAt,
      refreshes: { create: { hash: hash(refreshToken) } },
    } });
    return { sessionId: row.id, userId, kind, installationId, accessToken, refreshToken, accessExpiresAt, refreshExpiresAt };
  }

  async login(subject: string, credential: string) {
    const identity = await this.provider.authenticate(subject, credential);
    return this.locked('identity:' + identity.provider + ':' + identity.subject, async tx => {
      const found = await tx.authIdentity.findUnique({ where: { provider_subject: identity } });
      const userId = found?.userId ?? (await tx.user.create({ data: { identities: { create: identity } } })).id;
      return this.issue(tx, userId, 'WEB');
    });
  }

  async refresh(value: string) {
    this.enabled();
    const h = hash(value);
    const previous = await this.database.client.refreshCredential.findUnique({ where: { hash: h }, include: { session: true } });
    if (!previous) throw new ApiError(401, 'UNAUTHENTICATED');
    const result = await this.locked(this.sessionKey(previous.session), async tx => {
      const credential = await tx.refreshCredential.findUnique({ where: { hash: h } });
      const row = await this.session(tx, previous.sessionId);
      if (!credential || !row) return null;
      if (credential.usedAt) {
        // Commit family revocation before returning an error; throwing inside would roll it back.
        await tx.authSession.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
        return null;
      }
      const accessToken = secret(), refreshToken = secret();
      const accessExpiresAt = new Date(Math.min(Date.now() + 15 * 60_000, row.refreshExpiresAt.getTime()));
      await tx.refreshCredential.update({ where: { hash: h }, data: { usedAt: new Date() } });
      await tx.refreshCredential.create({ data: { hash: hash(refreshToken), sessionId: row.id } });
      await tx.authSession.update({ where: { id: row.id }, data: { accessHash: hash(accessToken), accessExpiresAt } });
      return { sessionId: row.id, userId: row.userId, kind: row.kind, installationId: row.installationId, accessToken, refreshToken, accessExpiresAt, refreshExpiresAt: row.refreshExpiresAt };
    });
    if (!result) throw new ApiError(401, 'UNAUTHENTICATED');
    return result;
  }

  async me(p: Principal) {
    const user = await this.database.client.user.findUniqueOrThrow({ where: { id: p.userId } });
    return { id: user.id, role: user.role, rankingPublic: user.rankingPublic };
  }

  async sessions(p: Principal) {
    return this.database.client.authSession.findMany({ where: { userId: p.userId }, select: {
      id: true, kind: true, installationId: true, accessExpiresAt: true, refreshExpiresAt: true, revokedAt: true, createdAt: true,
    }, orderBy: { createdAt: 'desc' } });
  }

  async revoke(p: Principal, id: string) {
    const target = await this.database.client.authSession.findFirst({ where: { id, userId: p.userId } });
    if (!target) throw new ApiError(404, 'RESOURCE_NOT_FOUND');
    await this.locked(this.sessionKey(target), async tx => {
      await this.principal(tx, p);
      const row = await tx.authSession.findFirst({ where: { id, userId: p.userId } });
      if (!row) throw new ApiError(404, 'RESOURCE_NOT_FOUND');
      await tx.authSession.update({ where: { id }, data: { revokedAt: new Date() } });
    });
  }

  async startPairing(id?: string, proof?: string) {
    this.enabled();
    return this.locked('installation:' + (id ?? secret()), async tx => {
      let installationSecret: string | undefined;
      let installation;
      if (id) {
        installation = await tx.installation.findUnique({ where: { id } });
        if (!installation || !proof || !sameHash(installation.secretHash, hash(proof))) throw new ApiError(401, 'UNAUTHENTICATED');
      } else {
        installationSecret = secret();
        installation = await tx.installation.create({ data: { secretHash: hash(installationSecret) } });
      }
      await tx.vehiclePairing.updateMany({ where: { installationId: installation.id, status: { in: ['PENDING', 'APPROVED'] } }, data: { status: 'CANCELLED' } });
      const deviceCode = secret(), userCode = randomBytes(6).toString('hex').toUpperCase();
      const expiresAt = new Date(Date.now() + 5 * 60_000);
      await tx.vehiclePairing.create({ data: { installationId: installation.id, deviceCodeHash: hash(deviceCode), userCodeHash: hash(userCode), expiresAt } });
      return { installationId: installation.id, installationSecret, deviceCode, userCode, expiresAt, intervalSeconds: 5 };
    });
  }

  async approve(p: Principal, code: string) {
    const h = hash(code.toUpperCase());
    const found = await this.database.client.vehiclePairing.findUnique({ where: { userCodeHash: h } });
    if (!found) throw new ApiError(404, 'RESOURCE_NOT_FOUND');
    return this.locked('installation:' + found.installationId, async tx => {
      await this.principal(tx, p, true);
      const row = await tx.vehiclePairing.findUniqueOrThrow({ where: { id: found.id } });
      if (row.status !== 'PENDING' || row.expiresAt <= new Date()) throw new ApiError(409, 'PAIRING_UNAVAILABLE');
      await tx.vehiclePairing.update({ where: { id: row.id }, data: { approvedById: p.userId, status: 'APPROVED' } });
      return { installationId: row.installationId, status: 'APPROVED' };
    });
  }

  async exchange(code: string) {
    this.enabled();
    const h = hash(code);
    const found = await this.database.client.vehiclePairing.findUnique({ where: { deviceCodeHash: h } });
    if (!found) throw new ApiError(401, 'UNAUTHENTICATED');
    return this.locked('installation:' + found.installationId, async tx => {
      const row = await tx.vehiclePairing.findUniqueOrThrow({ where: { id: found.id } });
      if (row.expiresAt <= new Date() || ['CONSUMED', 'CANCELLED'].includes(row.status)) throw new ApiError(409, 'PAIRING_UNAVAILABLE');
      if (row.status !== 'APPROVED' || !row.approvedById) throw new ApiError(409, 'AUTHORIZATION_PENDING', 5);
      await tx.authSession.updateMany({ where: { installationId: row.installationId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.installation.update({ where: { id: row.installationId }, data: { linkedUserId: row.approvedById, linkRevokedAt: null } });
      await tx.vehiclePairing.update({ where: { id: row.id }, data: { status: 'CONSUMED', consumedAt: new Date() } });
      return this.issue(tx, row.approvedById, 'VEHICLE', row.installationId);
    });
  }

  async links(p: Principal) {
    return this.database.client.installation.findMany({ where: { linkedUserId: p.userId, linkRevokedAt: null }, select: { id: true, createdAt: true }, orderBy: { createdAt: 'desc' } });
  }

  async unlink(p: Principal, id: string) {
    await this.locked('installation:' + id, async tx => {
      await this.principal(tx, p, true);
      const row = await tx.installation.findUnique({ where: { id } });
      if (!row || row.linkedUserId !== p.userId || row.linkRevokedAt) throw new ApiError(404, 'RESOURCE_NOT_FOUND');
      await tx.installation.update({ where: { id }, data: { linkedUserId: null, linkRevokedAt: new Date() } });
      await tx.authSession.updateMany({ where: { installationId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.vehiclePairing.updateMany({ where: { installationId: id, status: { in: ['PENDING', 'APPROVED'] } }, data: { status: 'CANCELLED' } });
    });
  }

  async adminRevoke(p: Principal, id: string) {
    const target = await this.database.client.authSession.findUnique({ where: { id } });
    if (!target) throw new ApiError(404, 'RESOURCE_NOT_FOUND');
    await this.locked(this.sessionKey(target), async tx => {
      const admin = await this.principal(tx, p, true);
      if (admin.user.role !== 'ADMIN') throw new ApiError(403, 'FORBIDDEN');
      await tx.authSession.update({ where: { id }, data: { revokedAt: new Date() } });
    });
  }
}
