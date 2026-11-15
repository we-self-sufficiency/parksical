BEGIN;
-- CreateTable
CREATE TABLE "RewardSettlement" (
    "id" UUID NOT NULL,
    "sourceMonth" CHAR(7) NOT NULL,
    "policyVersion" VARCHAR(32) NOT NULL,
    "state" VARCHAR(24) NOT NULL,
    "cutoffAt" TIMESTAMPTZ(3) NOT NULL,
    "eligibilityAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "completedAt" TIMESTAMPTZ(3),
    "manifest" JSONB,
    "inputHash" CHAR(64),

    CONSTRAINT "RewardSettlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardGrant" (
    "id" UUID NOT NULL,
    "settlementId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "snapshotId" UUID NOT NULL,
    "slot" INTEGER NOT NULL,
    "state" VARCHAR(16) NOT NULL,
    "decision" JSONB NOT NULL,

    CONSTRAINT "RewardGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SandboxCoupon" (
    "id" UUID NOT NULL,
    "grantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "sourceMonth" CHAR(7) NOT NULL,
    "issuedMonth" CHAR(7) NOT NULL,
    "slot" INTEGER NOT NULL,
    "policyVersion" VARCHAR(32) NOT NULL,
    "state" VARCHAR(16) NOT NULL,
    "maxAmountKrw" INTEGER NOT NULL,
    "maxDurationMinutes" INTEGER NOT NULL,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SandboxCoupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CouponClaim" (
    "id" UUID NOT NULL,
    "couponId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "state" VARCHAR(16) NOT NULL,
    "amountKrw" INTEGER NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "holdExpiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "receipt" JSONB,

    CONSTRAINT "CouponClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RewardNotification" (
    "id" UUID NOT NULL,
    "couponId" UUID NOT NULL,
    "state" VARCHAR(16) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL,
    "leaseId" UUID,
    "leaseUntil" TIMESTAMPTZ(3),
    "deliveredAt" TIMESTAMPTZ(3),
    "lastError" VARCHAR(32),

    CONSTRAINT "RewardNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SandboxNotificationDelivery" (
    "notificationId" UUID NOT NULL,
    "deliveryId" UUID NOT NULL,
    "deliveredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SandboxNotificationDelivery_pkey" PRIMARY KEY ("notificationId")
);

-- CreateTable
CREATE TABLE "RewardMutation" (
    "userId" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "work" JSONB,
    "response" JSONB,

    CONSTRAINT "RewardMutation_pkey" PRIMARY KEY ("userId","key")
);

-- CreateIndex
CREATE UNIQUE INDEX "RewardSettlement_sourceMonth_key" ON "RewardSettlement"("sourceMonth");

-- CreateIndex
CREATE UNIQUE INDEX "RewardGrant_settlementId_userId_slot_key" ON "RewardGrant"("settlementId", "userId", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "RewardGrant_settlementId_userId_lotId_key" ON "RewardGrant"("settlementId", "userId", "lotId");

-- CreateIndex
CREATE UNIQUE INDEX "SandboxCoupon_grantId_key" ON "SandboxCoupon"("grantId");

-- CreateIndex
CREATE INDEX "SandboxCoupon_userId_issuedAt_id_idx" ON "SandboxCoupon"("userId", "issuedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "SandboxCoupon_userId_sourceMonth_slot_key" ON "SandboxCoupon"("userId", "sourceMonth", "slot");

-- CreateIndex
CREATE UNIQUE INDEX "SandboxCoupon_userId_sourceMonth_lotId_key" ON "SandboxCoupon"("userId", "sourceMonth", "lotId");

-- CreateIndex
CREATE UNIQUE INDEX "CouponClaim_orderId_key" ON "CouponClaim"("orderId");

-- CreateIndex
CREATE INDEX "CouponClaim_couponId_state_idx" ON "CouponClaim"("couponId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "RewardNotification_couponId_key" ON "RewardNotification"("couponId");

-- CreateIndex
CREATE INDEX "RewardNotification_state_nextAttemptAt_idx" ON "RewardNotification"("state", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "SandboxNotificationDelivery_deliveryId_key" ON "SandboxNotificationDelivery"("deliveryId");

-- AddForeignKey
ALTER TABLE "RewardGrant" ADD CONSTRAINT "RewardGrant_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "RewardSettlement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardGrant" ADD CONSTRAINT "RewardGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardGrant" ADD CONSTRAINT "RewardGrant_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "ParkingLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardGrant" ADD CONSTRAINT "RewardGrant_runId_fkey" FOREIGN KEY ("runId") REFERENCES "MissionRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardGrant" ADD CONSTRAINT "RewardGrant_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "RankingMonthSnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SandboxCoupon" ADD CONSTRAINT "SandboxCoupon_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "RewardGrant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SandboxCoupon" ADD CONSTRAINT "SandboxCoupon_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponClaim" ADD CONSTRAINT "CouponClaim_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "SandboxCoupon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponClaim" ADD CONSTRAINT "CouponClaim_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PaymentOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardNotification" ADD CONSTRAINT "RewardNotification_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "SandboxCoupon"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RewardMutation" ADD CONSTRAINT "RewardMutation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "PaymentOrder" DROP CONSTRAINT payment_order_bounds;
ALTER TABLE "PaymentOrder" ADD CONSTRAINT payment_order_bounds CHECK(num_nonnulls("quoteId","reservationId","subscriptionCycleId")=1 AND (("subscriptionCycleId" IS NOT NULL AND "lotId" IS NULL) OR ("subscriptionCycleId" IS NULL AND "lotId" IS NOT NULL)) AND "amountKrw" BETWEEN 1 AND 100000000 AND currency='KRW' AND "createdAt"<"expiresAt" AND state IN ('CREATED','PENDING','SUCCEEDED','FAILED','CANCELLED','REFUND_PENDING','REFUNDED','COUPON_SETTLED','COUPON_VOIDED'));
CREATE UNIQUE INDEX coupon_single_active_use ON "CouponClaim"("couponId") WHERE state IN ('HELD','CONSUMED');
ALTER TABLE "RewardSettlement" ADD CONSTRAINT reward_settlement_bounds CHECK("sourceMonth"~'^20[0-9]{2}-(0[1-9]|1[0-2])$' AND "policyVersion"='rewards-sandbox-v1' AND state IN ('WAITING_CUTOFF','READY','COMPLETED') AND "cutoffAt"=(to_date("sourceMonth"||'-01','YYYY-MM-DD')+interval '1 month')::timestamp AT TIME ZONE 'Asia/Seoul'+interval '72 hours');
CREATE FUNCTION guard_reward_settlement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='INSERT' THEN IF NEW.state<>'WAITING_CUTOFF' OR NEW.manifest IS NOT NULL OR NEW."inputHash" IS NOT NULL OR NEW."completedAt" IS NOT NULL THEN RAISE EXCEPTION 'Settlement starts waiting';END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['state','manifest','inputHash','completedAt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','manifest','inputHash','completedAt']) OR NOT ((OLD.state='WAITING_CUTOFF' AND NEW.state='READY' AND NEW.manifest IS NOT NULL AND NEW."inputHash" IS NOT NULL AND NEW."completedAt" IS NULL) OR (OLD.state='READY' AND NEW.state='COMPLETED' AND NEW.manifest=OLD.manifest AND NEW."inputHash"=OLD."inputHash" AND NEW."completedAt" IS NOT NULL)) THEN RAISE EXCEPTION 'Immutable settlement input or invalid state';END IF;
 END IF;RETURN NEW;END $$;
CREATE TRIGGER reward_settlement_guard BEFORE INSERT OR UPDATE ON "RewardSettlement" FOR EACH ROW EXECUTE FUNCTION guard_reward_settlement();
ALTER TABLE "RewardGrant" ADD CONSTRAINT reward_grant_bounds CHECK(slot BETWEEN 1 AND 2 AND state IN ('PENDING','ISSUED','SKIPPED') AND decision ?& ARRAY['rank','score','passActive'] AND (decision->>'rank')::int=1 AND (decision->>'score')::int>=3 AND (decision->>'passActive')::boolean);
CREATE FUNCTION guard_reward_grant() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'PENDING' OR NOT EXISTS(SELECT 1 FROM "MissionRun" r JOIN "RankingMonthSnapshot" s ON s.id=NEW."snapshotId" JOIN "RewardSettlement" t ON t.id=NEW."settlementId" WHERE r.id=NEW."runId" AND r."userId"=NEW."userId" AND r."lotId"=NEW."lotId" AND r.mode='CHALLENGE' AND r.source='SYNTHETIC' AND s."lotId"=r."lotId" AND s.month=t."sourceMonth" AND t.state='READY') THEN RAISE EXCEPTION 'Grant must match frozen synthetic owned source';END IF;
 ELSE IF (to_jsonb(NEW)-'state') IS DISTINCT FROM (to_jsonb(OLD)-'state') OR OLD.state<>'PENDING' OR NEW.state NOT IN ('ISSUED','SKIPPED') THEN RAISE EXCEPTION 'Invalid immutable grant mutation';END IF;END IF;RETURN NEW;END $$;
CREATE TRIGGER reward_grant_guard BEFORE INSERT OR UPDATE ON "RewardGrant" FOR EACH ROW EXECUTE FUNCTION guard_reward_grant();
ALTER TABLE "SandboxCoupon" ADD CONSTRAINT sandbox_coupon_bounds CHECK(slot BETWEEN 1 AND 2 AND "policyVersion"='rewards-sandbox-v1' AND state IN ('AVAILABLE','HELD','USED','CANCELLED','EXPIRED') AND "maxAmountKrw"=5000 AND "maxDurationMinutes"=120 AND "expiresAt"="issuedAt"+interval '30 days' AND "issuedMonth"=to_char("issuedAt" AT TIME ZONE 'Asia/Seoul','YYYY-MM'));
CREATE FUNCTION guard_sandbox_coupon() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'AVAILABLE' OR NOT EXISTS(SELECT 1 FROM "RewardGrant" g JOIN "RewardSettlement" s ON s.id=g."settlementId" WHERE g.id=NEW."grantId" AND g.state='PENDING' AND g."userId"=NEW."userId" AND g."lotId"=NEW."lotId" AND g.slot=NEW.slot AND s."sourceMonth"=NEW."sourceMonth" AND NEW."issuedAt">=s."cutoffAt") THEN RAISE EXCEPTION 'Coupon must match bounded pending grant';END IF;
 ELSE
  IF (to_jsonb(NEW)-'state') IS DISTINCT FROM (to_jsonb(OLD)-'state') OR NOT ((OLD.state='AVAILABLE' AND NEW.state IN ('HELD','CANCELLED','EXPIRED')) OR (OLD.state='HELD' AND NEW.state IN ('AVAILABLE','USED','CANCELLED','EXPIRED')) OR (OLD.state='USED' AND NEW.state='CANCELLED')) THEN RAISE EXCEPTION 'Invalid coupon mutation';END IF;
 END IF;RETURN NEW;END $$;
CREATE TRIGGER sandbox_coupon_guard BEFORE INSERT OR UPDATE ON "SandboxCoupon" FOR EACH ROW EXECUTE FUNCTION guard_sandbox_coupon();
ALTER TABLE "CouponClaim" ADD CONSTRAINT coupon_claim_bounds CHECK(state IN ('HELD','CONSUMED','RELEASED','VOIDED') AND "amountKrw" BETWEEN 1 AND 5000 AND "durationMinutes" BETWEEN 30 AND 120 AND mod("durationMinutes",30)=0 AND "createdAt"<"holdExpiresAt" AND ((state IN ('HELD','RELEASED') AND "consumedAt" IS NULL AND receipt IS NULL) OR (state IN ('CONSUMED','VOIDED') AND "consumedAt" IS NOT NULL AND receipt IS NOT NULL)));
CREATE FUNCTION guard_coupon_claim() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'HELD' OR NOT EXISTS(SELECT 1 FROM "SandboxCoupon" c JOIN "PaymentOrder" o ON o.id=NEW."orderId" WHERE c.id=NEW."couponId" AND c.state='AVAILABLE' AND c."userId"=o."userId" AND c."lotId"=o."lotId" AND o.state='CREATED' AND o."subscriptionCycleId" IS NULL AND NEW."amountKrw"=o."amountKrw" AND NEW."holdExpiresAt"<=c."expiresAt" AND NEW."holdExpiresAt"<=o."expiresAt") THEN RAISE EXCEPTION 'Invalid owned coupon/order hold';END IF;
 ELSE
  IF (to_jsonb(NEW)-ARRAY['state','consumedAt','receipt']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','consumedAt','receipt']) OR NOT ((OLD.state='HELD' AND NEW.state IN ('RELEASED','CONSUMED')) OR (OLD.state='CONSUMED' AND NEW.state='VOIDED' AND NEW.receipt=OLD.receipt AND NEW."consumedAt"=OLD."consumedAt")) THEN RAISE EXCEPTION 'Invalid coupon claim transition';END IF;
 END IF;RETURN NEW;END $$;
CREATE TRIGGER coupon_claim_guard BEFORE INSERT OR UPDATE ON "CouponClaim" FOR EACH ROW EXECUTE FUNCTION guard_coupon_claim();
ALTER TABLE "RewardNotification" ADD CONSTRAINT reward_notification_bounds CHECK(state IN ('PENDING','PROCESSING','DELIVERED','FAILED') AND attempts BETWEEN 0 AND 3 AND ((state='PROCESSING' AND "leaseId" IS NOT NULL AND "leaseUntil" IS NOT NULL) OR (state<>'PROCESSING' AND "leaseId" IS NULL AND "leaseUntil" IS NULL)) AND ((state='DELIVERED' AND "deliveredAt" IS NOT NULL) OR (state<>'DELIVERED' AND "deliveredAt" IS NULL)));
CREATE FUNCTION guard_reward_notification() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='INSERT' THEN IF NEW.state<>'PENDING' OR NEW.attempts<>0 THEN RAISE EXCEPTION 'Notice starts pending';END IF;
 ELSE
  IF ROW(NEW.id,NEW."couponId") IS DISTINCT FROM ROW(OLD.id,OLD."couponId") OR NOT ((OLD.state IN ('PENDING','PROCESSING') AND NEW.state='PROCESSING' AND NEW.attempts=OLD.attempts+1) OR (OLD.state='PROCESSING' AND NEW.state IN ('PENDING','DELIVERED','FAILED') AND NEW.attempts=OLD.attempts)) THEN RAISE EXCEPTION 'Invalid bounded notification transition';END IF;
 END IF;RETURN NEW;END $$;
CREATE TRIGGER reward_notification_guard BEFORE INSERT OR UPDATE ON "RewardNotification" FOR EACH ROW EXECUTE FUNCTION guard_reward_notification();
CREATE FUNCTION guard_reward_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF ROW(NEW."userId",NEW.key,NEW."requestHash") IS DISTINCT FROM ROW(OLD."userId",OLD.key,OLD."requestHash") OR (OLD.work IS NOT NULL AND NEW.work IS DISTINCT FROM OLD.work) OR (OLD.response IS NOT NULL AND NEW.response IS DISTINCT FROM OLD.response) THEN RAISE EXCEPTION 'Immutable reward command receipt';END IF;RETURN NEW;END $$;
CREATE TRIGGER reward_mutation_guard BEFORE UPDATE ON "RewardMutation" FOR EACH ROW EXECUTE FUNCTION guard_reward_mutation();

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
   (OLD.state='CREATED' AND NEW.state='COUPON_SETTLED' AND EXISTS(SELECT 1 FROM "CouponClaim" c WHERE c."orderId"=NEW.id AND c.state='CONSUMED')) OR
   (OLD.state='COUPON_SETTLED' AND NEW.state='COUPON_VOIDED' AND EXISTS(SELECT 1 FROM "CouponClaim" c WHERE c."orderId"=NEW.id AND c.state='VOIDED')) OR
   (OLD.state='PENDING' AND NEW.state IN ('SUCCEEDED','FAILED','CANCELLED','REFUND_PENDING','REFUNDED')) OR
   (OLD.state IN ('SUCCEEDED','CANCELLED') AND NEW.state IN ('REFUND_PENDING','REFUNDED')) OR
   (OLD.state='REFUND_PENDING' AND NEW.state='REFUNDED')
  ) THEN RAISE EXCEPTION 'Invalid payment order mutation';END IF;
 END IF;RETURN NEW;
END $$;
COMMIT;
