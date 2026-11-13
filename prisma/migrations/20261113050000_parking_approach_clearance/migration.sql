-- AlterTable
ALTER TABLE "ParkingSpace" ADD COLUMN     "aisleId" VARCHAR(32);

-- CreateTable
CREATE TABLE "LotDriveAisle" (
    "lotId" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "id" VARCHAR(32) NOT NULL,
    "floorId" VARCHAR(32) NOT NULL,
    "zoneId" VARCHAR(32) NOT NULL,

    CONSTRAINT "LotDriveAisle_pkey" PRIMARY KEY ("lotId","version","id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LotDriveAisle_lotId_version_floorId_zoneId_id_key" ON "LotDriveAisle"("lotId", "version", "floorId", "zoneId", "id");

-- AddForeignKey
ALTER TABLE "ParkingSpace" ADD CONSTRAINT "ParkingSpace_lotId_version_floorId_zoneId_aisleId_fkey" FOREIGN KEY ("lotId", "version", "floorId", "zoneId", "aisleId") REFERENCES "LotDriveAisle"("lotId", "version", "floorId", "zoneId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LotDriveAisle" ADD CONSTRAINT "LotDriveAisle_lotId_version_floorId_zoneId_fkey" FOREIGN KEY ("lotId", "version", "floorId", "zoneId") REFERENCES "LotZone"("lotId", "version", "floorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
