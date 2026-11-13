CREATE TABLE "ServiceMetadata" (
    "key" VARCHAR(64) NOT NULL,
    "value" VARCHAR(256) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ServiceMetadata_pkey" PRIMARY KEY ("key")
);
