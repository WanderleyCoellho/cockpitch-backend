-- AlterTable
ALTER TABLE "Proposal" ADD COLUMN     "backstageMedia" JSONB,
ADD COLUMN     "differentialsMedia" JSONB,
ADD COLUMN     "sections" JSONB,
ADD COLUMN     "theme" TEXT DEFAULT 'dark_luxury',
ADD COLUMN     "themeCustom" JSONB;

-- AlterTable
ALTER TABLE "Provider" ADD COLUMN     "aboutPortfolioMedia" JSONB,
ADD COLUMN     "chips" JSONB,
ADD COLUMN     "deliveryTimes" TEXT,
ADD COLUMN     "differentialsMedia" JSONB,
ADD COLUMN     "differentialsText" TEXT,
ADD COLUMN     "differentialsTitle" TEXT,
ADD COLUMN     "heroVideoUrl" TEXT,
ADD COLUMN     "partners" JSONB,
ADD COLUMN     "styleText" TEXT,
ADD COLUMN     "testimonials" JSONB;
