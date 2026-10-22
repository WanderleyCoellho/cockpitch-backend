-- CreateEnum
CREATE TYPE "PackagePriceMode" AS ENUM ('SUM_OF_ITEMS', 'FIXED', 'ON_REQUEST');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('NONE', 'PERCENT', 'AMOUNT');

-- CreateEnum
CREATE TYPE "PackageItemKind" AS ENUM ('INCLUDED', 'OPTIONAL', 'COURTESY');

-- AlterTable
ALTER TABLE "Package" ADD COLUMN     "discountType" "DiscountType" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "discountValue" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "fixedPriceCents" INTEGER,
ADD COLUMN     "priceLabel" TEXT,
ADD COLUMN     "priceMode" "PackagePriceMode" NOT NULL DEFAULT 'FIXED';

-- AlterTable
ALTER TABLE "PackageItem" ADD COLUMN     "description" TEXT,
ADD COLUMN     "kind" "PackageItemKind" NOT NULL DEFAULT 'INCLUDED',
ADD COLUMN     "quantity" DECIMAL(12,2) NOT NULL DEFAULT 1,
ADD COLUMN     "unit" TEXT,
ADD COLUMN     "unitPriceCents" INTEGER NOT NULL DEFAULT 0;


-- =====================================================================
-- Migração de dados: preço em texto ("3500.00") → centavos; cortesia → kind.
-- Preços que não são numéricos viram "Sob consulta" com o texto original como rótulo.
-- =====================================================================
UPDATE "Package"
SET "fixedPriceCents" = ROUND(CAST("price" AS NUMERIC) * 100)::INTEGER,
    "priceMode" = 'FIXED'
WHERE "price" ~ '^\s*\d+(\.\d{1,2})?\s*$';

UPDATE "Package"
SET "priceMode" = 'ON_REQUEST',
    "priceLabel" = "price"
WHERE "fixedPriceCents" IS NULL;

UPDATE "PackageItem" SET "kind" = 'COURTESY' WHERE "isCourtesy" = true;
