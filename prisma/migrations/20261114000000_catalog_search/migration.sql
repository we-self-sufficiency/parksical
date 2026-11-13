ALTER TABLE "LotRevision" ADD COLUMN "discountCodes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
CREATE INDEX "LotRevision_source_active_latitude_longitude_idx" ON "LotRevision"("source", "active", "latitude", "longitude");
CREATE INDEX "LotRevision_discountCodes_idx" ON "LotRevision" USING GIN ("discountCodes");
