-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "WorkspaceEventType" ADD VALUE 'OWNERSHIP_TRANSFERRED';
ALTER TYPE "WorkspaceEventType" ADD VALUE 'WORKSPACE_CLOSED';

-- DropForeignKey
ALTER TABLE "PaymentReceipt" DROP CONSTRAINT "PaymentReceipt_userId_fkey";

-- DropForeignKey
ALTER TABLE "Provider" DROP CONSTRAINT "Provider_userId_fkey";

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "paymentGraceUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PaymentReceipt" ALTER COLUMN "userId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "Provider" ALTER COLUMN "userId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "AccountDeletionCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountDeletionCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountDeletionCode_userId_createdAt_idx" ON "AccountDeletionCode"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "AccountDeletionCode" ADD CONSTRAINT "AccountDeletionCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentReceipt" ADD CONSTRAINT "PaymentReceipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Provider" ADD CONSTRAINT "Provider_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

