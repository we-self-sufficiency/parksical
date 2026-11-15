import { randomUUID } from 'node:crypto';
import { ApiError } from '../api-error.js';
import type { ReservationSandboxEventDto } from './dto.js';
// No provider webhook or client-supplied amount/signature is accepted by this test adapter.
export interface ReservationPaymentEvidence {
  providerEventId: string; source: 'SANDBOX'; realPaymentVerified: false;
  reservationId: string; kind: ReservationSandboxEventDto['kind']; currency: 'KRW'; amountKrw: number;
}
export interface ReservationPaymentPort {
  createSandboxEvidence(reservationId: string, amountKrw: number, kind: ReservationSandboxEventDto['kind']): ReservationPaymentEvidence;
}
// S-16 must construct this only after provider signature AND server lookup verification.
// This is an internal port contract, never a DTO or a client-asserted authorization.
export interface VerifiedProviderReservationPayment {
  providerEventId: string; providerOrderId: string; reservationId: string; quoteId: string;
  currency: 'KRW'; amountKrw: number; kind: ReservationSandboxEventDto['kind'];
  signatureVerified: true; providerLookupVerified: true;
}
export interface RealReservationPaymentVerifier {
  verify(rawProviderEvent: unknown): Promise<VerifiedProviderReservationPayment>;
}
export class UnavailableRealReservationPayments implements RealReservationPaymentVerifier {
  verify(): never { throw new ApiError(503, 'PAYMENT_PROVIDER_NOT_IMPLEMENTED'); }
}
export class SandboxReservationPayments implements ReservationPaymentPort {
  createSandboxEvidence(reservationId: string, amountKrw: number, kind: ReservationSandboxEventDto['kind']): ReservationPaymentEvidence {
    return { providerEventId: randomUUID(), source: 'SANDBOX', realPaymentVerified: false, reservationId, kind, currency: 'KRW', amountKrw };
  }
}
export const RESERVATION_PAYMENTS = Symbol('RESERVATION_PAYMENTS');
