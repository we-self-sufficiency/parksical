-- CreateTable
CREATE TABLE "ReviewVisit" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "lotId" UUID NOT NULL,
    "lotVersion" INTEGER NOT NULL,
    "source" VARCHAR(16) NOT NULL DEFAULT 'SYNTHETIC',
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewVisit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" UUID NOT NULL,
    "visitId" UUID NOT NULL,
    "rating" VARCHAR(8),
    "version" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReviewAggregate" (
    "lotId" UUID NOT NULL,
    "lotVersion" INTEGER NOT NULL,
    "source" VARCHAR(16) NOT NULL DEFAULT 'SYNTHETIC',
    "scoreSum" BIGINT NOT NULL,
    "sampleCount" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ReviewAggregate_pkey" PRIMARY KEY ("lotId","lotVersion")
);

-- CreateTable
CREATE TABLE "ReviewMutation" (
    "authSessionId" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "response" JSONB NOT NULL,

    CONSTRAINT "ReviewMutation_pkey" PRIMARY KEY ("authSessionId","key")
);

-- CreateIndex
CREATE INDEX "ReviewVisit_lotId_lotVersion_idx" ON "ReviewVisit"("lotId", "lotVersion");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewVisit_userId_lotId_lotVersion_key" ON "ReviewVisit"("userId", "lotId", "lotVersion");

-- CreateIndex
CREATE UNIQUE INDEX "Review_visitId_key" ON "Review"("visitId");

-- AddForeignKey
ALTER TABLE "ReviewVisit" ADD CONSTRAINT "ReviewVisit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewVisit" ADD CONSTRAINT "ReviewVisit_lotId_lotVersion_fkey" FOREIGN KEY ("lotId", "lotVersion") REFERENCES "LotRevision"("lotId", "version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_visitId_fkey" FOREIGN KEY ("visitId") REFERENCES "ReviewVisit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewAggregate" ADD CONSTRAINT "ReviewAggregate_lotId_lotVersion_fkey" FOREIGN KEY ("lotId", "lotVersion") REFERENCES "LotRevision"("lotId", "version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewMutation" ADD CONSTRAINT "ReviewMutation_authSessionId_fkey" FOREIGN KEY ("authSessionId") REFERENCES "AuthSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reject raw SQL bypass of synthetic-only provenance and invalid aggregate/row states.
ALTER TABLE "ReviewVisit" ADD CONSTRAINT "ReviewVisit_source_check" CHECK (source='SYNTHETIC');
ALTER TABLE "Review" ADD CONSTRAINT "Review_rating_check" CHECK (("deletedAt" IS NULL AND rating IS NOT NULL AND rating IN ('EASY','NORMAL','HARD')) OR ("deletedAt" IS NOT NULL AND rating IS NULL));
ALTER TABLE "Review" ADD CONSTRAINT "Review_version_check" CHECK (version>=1);
ALTER TABLE "ReviewAggregate" ADD CONSTRAINT "ReviewAggregate_values_check" CHECK (source='SYNTHETIC' AND "sampleCount">=0 AND "scoreSum">="sampleCount" AND "scoreSum"<=5::bigint*"sampleCount" AND version>=1);
