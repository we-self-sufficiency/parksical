-- CreateTable
CREATE TABLE "QrAccessGrant" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "issuerSessionId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "issueKey" VARCHAR(64) NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "accessEpoch" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "consumedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "exchangeHash" CHAR(64),

    CONSTRAINT "QrAccessGrant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QrPhoneSession" (
    "grantId" UUID NOT NULL,
    "secretHash" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "QrPhoneSession_pkey" PRIMARY KEY ("grantId")
);

-- CreateIndex
CREATE UNIQUE INDEX "QrAccessGrant_tokenHash_key" ON "QrAccessGrant"("tokenHash");

-- CreateIndex
CREATE INDEX "QrAccessGrant_locationId_revokedAt_idx" ON "QrAccessGrant"("locationId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "QrAccessGrant_userId_issueKey_key" ON "QrAccessGrant"("userId", "issueKey");

-- CreateIndex
CREATE UNIQUE INDEX "QrPhoneSession_secretHash_key" ON "QrPhoneSession"("secretHash");

-- AddForeignKey
ALTER TABLE "QrAccessGrant" ADD CONSTRAINT "QrAccessGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QrAccessGrant" ADD CONSTRAINT "QrAccessGrant_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "ParkedLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QrAccessGrant" ADD CONSTRAINT "QrAccessGrant_issuerSessionId_fkey" FOREIGN KEY ("issuerSessionId") REFERENCES "AuthSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QrPhoneSession" ADD CONSTRAINT "QrPhoneSession_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "QrAccessGrant"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Development grant/session lifetime and consumption consistency.
ALTER TABLE "QrAccessGrant" ADD CONSTRAINT "QrAccessGrant_lifetime_check" CHECK ("accessEpoch">0 AND "expiresAt">"createdAt" AND "expiresAt" <= "createdAt"+INTERVAL '24 hours');
ALTER TABLE "QrAccessGrant" ADD CONSTRAINT "QrAccessGrant_consumed_check" CHECK (("consumedAt" IS NULL)=("exchangeHash" IS NULL));
ALTER TABLE "QrPhoneSession" ADD CONSTRAINT "QrPhoneSession_lifetime_check" CHECK ("expiresAt">"createdAt");
