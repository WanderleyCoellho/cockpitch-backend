-- AlterTable
ALTER TABLE "Proposal" ADD COLUMN     "sectionsConfig" JSONB,
ADD COLUMN     "videoSoundEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Provider" ADD COLUMN     "contactInfo" JSONB;
