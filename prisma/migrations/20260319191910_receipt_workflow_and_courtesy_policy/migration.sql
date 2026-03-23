-- CreateEnum
CREATE TYPE "LicensePolicy" AS ENUM ('STANDARD', 'COURTESY');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('SUBMITTED', 'ANALYZED', 'NEEDS_HUMAN_REVIEW', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ReceiptRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "licensePolicy" "LicensePolicy" NOT NULL DEFAULT 'STANDARD',
ADD COLUMN     "licensePolicyNote" TEXT;

-- CreateTable
CREATE TABLE "PaymentReceipt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "storedFilename" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'SUBMITTED',
    "riskLevel" "ReceiptRiskLevel" NOT NULL DEFAULT 'MEDIUM',
    "analysisSummary" TEXT,
    "extractedText" TEXT,
    "detectedAmount" TEXT,
    "detectedTransferDate" TEXT,
    "payerName" TEXT,
    "recipientName" TEXT,
    "reviewerName" TEXT,
    "reviewerNotes" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentReceipt_userId_idx" ON "PaymentReceipt"("userId");

-- CreateIndex
CREATE INDEX "PaymentReceipt_status_idx" ON "PaymentReceipt"("status");

-- AddForeignKey
ALTER TABLE "PaymentReceipt" ADD CONSTRAINT "PaymentReceipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
