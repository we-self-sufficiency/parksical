import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../api-error.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { DatabaseService } from '../database.service.js';
import type { SandboxProviderPayment } from '../generated/prisma/client.js';
export interface ProviderPayment {
  orderId: string; transactionId: string; currency: string; amountKrw: number;
  status: 'SUCCEEDED' | 'FAILED' | 'REFUNDED';
}
export interface PaymentProvider {
  capture(order: { id: string; amountKrw: number }, outcome: 'SUCCEEDED' | 'FAILED'): Promise<ProviderPayment>;
  lookup(orderId: string): Promise<ProviderPayment | null>;
  refund(orderId: string, transactionId: string, amountKrw: number): Promise<ProviderPayment>;
  verifyWebhook(raw: Buffer, timestamp: string | undefined, signature: string | undefined): void;
}
export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
export function signWebhook(secret: string, timestamp: string, raw: Buffer) {
  return createHmac('sha256', secret).update(timestamp + '.').update(raw).digest('hex');
}
export function verifyWebhook(secret: string, raw: Buffer, timestamp: string | undefined, signature: string | undefined, now = Date.now()) {
  if (!timestamp || !/^\d{10}$/.test(timestamp) || Math.abs(now - Number(timestamp) * 1000) > 300000 || !signature || !/^[a-f0-9]{64}$/.test(signature) || !timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(signWebhook(secret, timestamp, raw), 'hex'))) throw new ApiError(401, 'INVALID_PAYMENT_SIGNATURE');
}
// Separate durable store/transaction models an external provider. Never called inside a merchant transaction.
// A selected real PG must replace this adapter; these rows are synthetic, never card data or real charges.
@Injectable()
export class SandboxPaymentProvider implements PaymentProvider {
  constructor(private readonly db: DatabaseService, @Inject(APP_CONFIG) private readonly config: AppConfig) {}
  private enabled() {
    if (this.config.nodeEnv === 'production' || !this.config.devAuthEnabled || !this.config.devPaymentsEnabled || !this.config.paymentWebhookSecret) throw new ApiError(403, 'PAYMENTS_POLICY_DISABLED');
  }
  private evidence(row:SandboxProviderPayment):ProviderPayment {
    if(!['SUCCEEDED','FAILED','REFUNDED'].includes(row.status))throw new ApiError(503,'INVALID_PROVIDER_STATE');
    return {...row,status:row.status as ProviderPayment['status']};
  }
  async lookup(orderId: string): Promise<ProviderPayment | null> {
    this.enabled(); const row=await this.db.client.sandboxProviderPayment.findUnique({ where: { orderId } });return row?this.evidence(row):null;
  }
  async capture(order: { id: string; amountKrw: number }, outcome: 'SUCCEEDED' | 'FAILED'): Promise<ProviderPayment> {
    this.enabled();
    return this.db.client.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'sandbox-provider:' + order.id},0))`;
      const old = await tx.sandboxProviderPayment.findUnique({ where: { orderId: order.id } });
      if (old) { if (old.amountKrw !== order.amountKrw || old.outcome !== outcome) throw new ApiError(409, 'PROVIDER_COMMAND_CONFLICT'); return this.evidence(old); }
      return this.evidence(await tx.sandboxProviderPayment.create({ data: { orderId: order.id, transactionId: randomUUID(), amountKrw: order.amountKrw, currency: 'KRW', outcome, status: outcome } }));
    });
  }
  async refund(orderId: string, transactionId: string, amountKrw: number): Promise<ProviderPayment> {
    this.enabled();
    return this.db.client.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${'sandbox-provider:' + orderId},0))`;
      const row = await tx.sandboxProviderPayment.findUnique({ where: { orderId } });
      if (!row || row.transactionId !== transactionId || row.amountKrw !== amountKrw || row.status === 'FAILED') throw new ApiError(409, 'PROVIDER_REFUND_CONFLICT');
      if (row.status === 'REFUNDED') return this.evidence(row);
      return this.evidence(await tx.sandboxProviderPayment.update({ where: { orderId }, data: { status: 'REFUNDED' } }));
    });
  }
  verifyWebhook(raw: Buffer, timestamp: string | undefined, signature: string | undefined) {
    this.enabled(); verifyWebhook(this.config.paymentWebhookSecret!, raw, timestamp, signature);
  }
}
