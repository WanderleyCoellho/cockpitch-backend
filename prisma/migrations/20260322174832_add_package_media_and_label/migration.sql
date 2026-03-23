-- AlterTable
ALTER TABLE "Package" ADD COLUMN     "mediaType" TEXT,
ADD COLUMN     "mediaUrl" TEXT;

-- AlterTable
ALTER TABLE "Provider" ADD COLUMN     "packageLabel" TEXT;
