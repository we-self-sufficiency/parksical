BEGIN;
-- AlterTable
ALTER TABLE "PaymentOrder" ADD COLUMN     "subscriptionCycleId" UUID,
ALTER COLUMN "lotId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Subscription" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "planCode" VARCHAR(32) NOT NULL,
    "priceVersion" VARCHAR(32) NOT NULL,
    "policyVersion" VARCHAR(32) NOT NULL,
    "anchorAt" TIMESTAMPTZ(3) NOT NULL,
    "renewalEnabled" BOOLEAN NOT NULL DEFAULT true,
    "cancelledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionCycle" (
    "id" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "cycleIndex" INTEGER NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "chargeDeadline" TIMESTAMPTZ(3) NOT NULL,
    "amountKrw" INTEGER NOT NULL,
    "pricing" JSONB NOT NULL,
    "paidAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "SubscriptionCycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionChange" (
    "id" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "cycleId" UUID,
    "kind" VARCHAR(32) NOT NULL,
    "observedAt" TIMESTAMPTZ(3) NOT NULL,
    "details" JSONB NOT NULL,

    CONSTRAINT "SubscriptionChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionMutation" (
    "userId" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "response" JSONB NOT NULL,

    CONSTRAINT "SubscriptionMutation_pkey" PRIMARY KEY ("userId","key")
);

-- CreateIndex
CREATE INDEX "Subscription_userId_createdAt_id_idx" ON "Subscription"("userId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionCycle_subscriptionId_cycleIndex_key" ON "SubscriptionCycle"("subscriptionId", "cycleIndex");

-- CreateIndex
CREATE INDEX "SubscriptionChange_subscriptionId_observedAt_id_idx" ON "SubscriptionChange"("subscriptionId", "observedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionChange_cycleId_kind_key" ON "SubscriptionChange"("cycleId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentOrder_subscriptionCycleId_key" ON "PaymentOrder"("subscriptionCycleId");

-- AddForeignKey
ALTER TABLE "PaymentOrder" ADD CONSTRAINT "PaymentOrder_subscriptionCycleId_fkey" FOREIGN KEY ("subscriptionCycleId") REFERENCES "SubscriptionCycle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionCycle" ADD CONSTRAINT "SubscriptionCycle_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionChange" ADD CONSTRAINT "SubscriptionChange_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionMutation" ADD CONSTRAINT "SubscriptionMutation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "PaymentOrder" DROP CONSTRAINT payment_order_bounds;
ALTER TABLE "PaymentOrder" ADD CONSTRAINT payment_order_bounds CHECK (
 num_nonnulls("quoteId","reservationId","subscriptionCycleId")=1 AND
 (("subscriptionCycleId" IS NOT NULL AND "lotId" IS NULL) OR ("subscriptionCycleId" IS NULL AND "lotId" IS NOT NULL)) AND
 "amountKrw" BETWEEN 1 AND 100000000 AND currency='KRW' AND "createdAt"<"expiresAt" AND state IN ('CREATED','PENDING','SUCCEEDED','FAILED','CANCELLED','REFUND_PENDING','REFUNDED')
);
CREATE OR REPLACE FUNCTION guard_payment_order() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'CREATED' OR NOT (
   (NEW."quoteId" IS NOT NULL AND EXISTS(SELECT 1 FROM "PaymentQuote" q WHERE q.id=NEW."quoteId" AND q."userId"=NEW."userId" AND q."lotId"=NEW."lotId" AND q."amountKrw"=NEW."amountKrw" AND q.details=NEW.pricing AND q."expiresAt"=NEW."expiresAt")) OR
   (NEW."reservationId" IS NOT NULL AND EXISTS(SELECT 1 FROM "Reservation" r JOIN "ReservationQuote" q ON q.id=r."quoteId" WHERE r.id=NEW."reservationId" AND r."userId"=NEW."userId" AND r."lotId"=NEW."lotId" AND q."amountKrw"=NEW."amountKrw" AND q.details=NEW.pricing AND r."holdExpiresAt"=NEW."expiresAt" AND r.state='HELD')) OR
   (NEW."subscriptionCycleId" IS NOT NULL AND EXISTS(SELECT 1 FROM "SubscriptionCycle" c JOIN "Subscription" s ON s.id=c."subscriptionId" WHERE c.id=NEW."subscriptionCycleId" AND s."userId"=NEW."userId" AND c."amountKrw"=NEW."amountKrw" AND c.pricing=NEW.pricing AND c."chargeDeadline"=NEW."expiresAt"))
  ) THEN RAISE EXCEPTION 'Order must match its owned immutable source';END IF;
 ELSE
  IF (to_jsonb(NEW)-'state') IS DISTINCT FROM (to_jsonb(OLD)-'state') OR NOT (
   (OLD.state='CREATED' AND NEW.state IN ('PENDING','CANCELLED')) OR
   (OLD.state='PENDING' AND NEW.state IN ('SUCCEEDED','FAILED','CANCELLED','REFUND_PENDING','REFUNDED')) OR
   (OLD.state IN ('SUCCEEDED','CANCELLED') AND NEW.state IN ('REFUND_PENDING','REFUNDED')) OR
   (OLD.state='REFUND_PENDING' AND NEW.state='REFUNDED')
  ) THEN RAISE EXCEPTION 'Invalid payment order mutation';END IF;
 END IF;RETURN NEW;
END $$;
ALTER TABLE "Subscription" ADD CONSTRAINT subscription_product CHECK ("planCode"='MAX_PASS' AND "priceVersion"='max-pass-4900-v1' AND "policyVersion"='subscriptions-v1' AND "anchorAt"="createdAt" AND (("renewalEnabled" AND "cancelledAt" IS NULL) OR (NOT "renewalEnabled" AND "cancelledAt">="createdAt")));
CREATE FUNCTION guard_subscription() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NOT NEW."renewalEnabled" OR NEW."cancelledAt" IS NOT NULL THEN RAISE EXCEPTION 'Subscription must start enabled';END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['renewalEnabled','cancelledAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['renewalEnabled','cancelledAt']) OR NOT OLD."renewalEnabled" OR NEW."renewalEnabled" OR NEW."cancelledAt" IS NULL THEN RAISE EXCEPTION 'Invalid subscription cancellation';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER subscription_guard BEFORE INSERT OR UPDATE ON "Subscription" FOR EACH ROW EXECUTE FUNCTION guard_subscription();
ALTER TABLE "SubscriptionCycle" ADD CONSTRAINT subscription_cycle_bounds CHECK ("cycleIndex" BETWEEN 0 AND 999 AND "amountKrw"=4900 AND "startsAt"<"endsAt" AND "chargeDeadline"="startsAt"+interval '5 minutes' AND pricing ?& ARRAY['code','priceVersion','policyVersion','amountKrw','currency','period','cycleIndex','startsAt','endsAt'] AND pricing->>'currency'='KRW' AND pricing->>'priceVersion'='max-pass-4900-v1' AND (pricing->>'amountKrw')::int="amountKrw");
CREATE FUNCTION guard_subscription_cycle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a timestamptz;
BEGIN
 IF TG_OP='INSERT' THEN
  SELECT "anchorAt" INTO a FROM "Subscription" WHERE id=NEW."subscriptionId";
  IF NEW."paidAt" IS NOT NULL OR NEW."revokedAt" IS NOT NULL OR
    NEW."startsAt"<>((a AT TIME ZONE 'Asia/Seoul')+make_interval(months=>NEW."cycleIndex")) AT TIME ZONE 'Asia/Seoul' OR
    NEW."endsAt"<>((a AT TIME ZONE 'Asia/Seoul')+make_interval(months=>NEW."cycleIndex"+1)) AT TIME ZONE 'Asia/Seoul' THEN RAISE EXCEPTION 'Cycle must match original monthly anchor';END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['paidAt','revokedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['paidAt','revokedAt']) OR
    (OLD."paidAt" IS NOT NULL AND NEW."paidAt" IS DISTINCT FROM OLD."paidAt") OR
    (OLD."revokedAt" IS NOT NULL AND NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt") THEN RAISE EXCEPTION 'Immutable subscription cycle history';END IF;
  IF NEW."paidAt" IS DISTINCT FROM OLD."paidAt" AND NOT EXISTS(SELECT 1 FROM "PaymentOrder" o WHERE o."subscriptionCycleId"=NEW.id AND o.state='SUCCEEDED') THEN RAISE EXCEPTION 'Only verified successful payment grants coverage';END IF;
  IF NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt" AND NOT EXISTS(SELECT 1 FROM "PaymentOrder" o WHERE o."subscriptionCycleId"=NEW.id AND o.state IN ('CANCELLED','REFUND_PENDING','REFUNDED')) THEN RAISE EXCEPTION 'Revocation requires cancelled/refunding payment';END IF;
 END IF;RETURN NEW;
END $$;
CREATE TRIGGER subscription_cycle_guard BEFORE INSERT OR UPDATE ON "SubscriptionCycle" FOR EACH ROW EXECUTE FUNCTION guard_subscription_cycle();
ALTER TABLE "SubscriptionChange" ADD CONSTRAINT subscription_change_kind CHECK (kind IN ('CREATED','SUPERSEDED','CANCELLED_RENEWAL','PAYMENT_SUCCEEDED','PAYMENT_FAILED','PAYMENT_CANCELLED','PAYMENT_REFUND_PENDING','PAYMENT_REFUNDED'));
CREATE TRIGGER subscription_change_immutable BEFORE UPDATE ON "SubscriptionChange" FOR EACH ROW EXECUTE FUNCTION payment_immutable();
CREATE TRIGGER subscription_mutation_immutable BEFORE UPDATE ON "SubscriptionMutation" FOR EACH ROW EXECUTE FUNCTION payment_immutable();

COMMIT;
