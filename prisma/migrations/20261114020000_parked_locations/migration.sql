-- CreateTable
CREATE TABLE "ParkedLocation" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "clientRecordId" VARCHAR(64) NOT NULL,
    "creationHash" CHAR(64) NOT NULL,
    "lotId" UUID NOT NULL,
    "structureVersion" INTEGER,
    "floorId" VARCHAR(32),
    "zoneId" VARCHAR(32),
    "parkingSpaceId" VARCHAR(32),
    "vehicleSessionId" UUID,
    "source" VARCHAR(16) NOT NULL DEFAULT 'SYNTHETIC',
    "original" JSONB NOT NULL,
    "selection" JSONB NOT NULL,
    "confidence" VARCHAR(8) NOT NULL,
    "distanceM" DOUBLE PRECISION,
    "note" VARCHAR(1000),
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "userEdited" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "accessEpoch" INTEGER NOT NULL DEFAULT 1,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ParkedLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationChange" (
    "locationId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" VARCHAR(16) NOT NULL,
    "before" JSONB,
    "after" JSONB NOT NULL,
    "actorKind" "SessionKind" NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocationChange_pkey" PRIMARY KEY ("locationId","version")
);

-- CreateTable
CREATE TABLE "LocationPhoto" (
    "id" UUID NOT NULL,
    "locationId" UUID NOT NULL,
    "mimeType" VARCHAR(32) NOT NULL DEFAULT 'image/jpeg',
    "byteSize" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "LocationPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrivatePhotoBlob" (
    "photoId" UUID NOT NULL,
    "bytes" BYTEA NOT NULL,

    CONSTRAINT "PrivatePhotoBlob_pkey" PRIMARY KEY ("photoId")
);

-- CreateTable
CREATE TABLE "LocationMutation" (
    "userId" UUID NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "locationId" UUID NOT NULL,
    "requestHash" CHAR(64) NOT NULL,
    "response" JSONB NOT NULL,

    CONSTRAINT "LocationMutation_pkey" PRIMARY KEY ("userId","key")
);

-- CreateIndex
CREATE INDEX "ParkedLocation_userId_deletedAt_occurredAt_id_idx" ON "ParkedLocation"("userId", "deletedAt", "occurredAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ParkedLocation_userId_clientRecordId_key" ON "ParkedLocation"("userId", "clientRecordId");

-- CreateIndex
CREATE INDEX "LocationPhoto_locationId_deletedAt_idx" ON "LocationPhoto"("locationId", "deletedAt");

-- AddForeignKey
ALTER TABLE "ParkedLocation" ADD CONSTRAINT "ParkedLocation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkedLocation" ADD CONSTRAINT "ParkedLocation_lotId_fkey" FOREIGN KEY ("lotId") REFERENCES "ParkingLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkedLocation" ADD CONSTRAINT "ParkedLocation_lotId_structureVersion_fkey" FOREIGN KEY ("lotId", "structureVersion") REFERENCES "LotRevision"("lotId", "version") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParkedLocation" ADD CONSTRAINT "ParkedLocation_vehicleSessionId_fkey" FOREIGN KEY ("vehicleSessionId") REFERENCES "VehicleSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationChange" ADD CONSTRAINT "LocationChange_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "ParkedLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationPhoto" ADD CONSTRAINT "LocationPhoto_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "ParkedLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrivatePhotoBlob" ADD CONSTRAINT "PrivatePhotoBlob_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "LocationPhoto"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationMutation" ADD CONSTRAINT "LocationMutation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationMutation" ADD CONSTRAINT "LocationMutation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "ParkedLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ParkedLocation" ADD CONSTRAINT "ParkedLocation_values_check" CHECK (source='SYNTHETIC' AND version>=1 AND "accessEpoch">=1 AND confidence IN ('HIGH','MEDIUM','LOW','UNKNOWN') AND ("distanceM" IS NULL OR ("distanceM">=0 AND "distanceM"<=100000)) AND ("structureVersion" IS NOT NULL OR ("floorId" IS NULL AND "zoneId" IS NULL AND "parkingSpaceId" IS NULL)) AND ("floorId" IS NOT NULL OR ("zoneId" IS NULL AND "parkingSpaceId" IS NULL)) AND ("parkingSpaceId" IS NULL OR "zoneId" IS NOT NULL));
ALTER TABLE "LocationPhoto" ADD CONSTRAINT "LocationPhoto_values_check" CHECK ("mimeType"='image/jpeg' AND "byteSize">0 AND "byteSize"<=2097152 AND width>0 AND height>0 AND width<=2048 AND height<=2048);
