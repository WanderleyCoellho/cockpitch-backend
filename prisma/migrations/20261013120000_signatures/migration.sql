-- CreateEnum
CREATE TYPE "SignatureRole" AS ENUM ('PROVIDER', 'CLIENT');

-- CreateEnum
CREATE TYPE "SignatureMethod" AS ENUM ('DRAWN', 'TYPED');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "cpf" TEXT,
ADD COLUMN     "savedSignature" JSONB;

-- CreateTable
CREATE TABLE "ProposalSignature" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "role" "SignatureRole" NOT NULL,
    "userId" TEXT,
    "responseId" TEXT,
    "signerName" TEXT NOT NULL,
    "signerEmail" TEXT NOT NULL,
    "signerDocument" TEXT NOT NULL,
    "signerTitle" TEXT,
    "method" "SignatureMethod" NOT NULL,
    "image" TEXT,
    "typedText" TEXT,
    "contentHash" TEXT NOT NULL,
    "emailVerifiedAt" TIMESTAMP(3) NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalSignature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SignatureCode" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "role" "SignatureRole" NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SignatureCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProposalSignature_responseId_key" ON "ProposalSignature"("responseId");

-- CreateIndex
CREATE INDEX "ProposalSignature_proposalId_role_createdAt_idx" ON "ProposalSignature"("proposalId", "role", "createdAt");

-- CreateIndex
CREATE INDEX "SignatureCode_proposalId_email_createdAt_idx" ON "SignatureCode"("proposalId", "email", "createdAt");

-- AddForeignKey
ALTER TABLE "ProposalSignature" ADD CONSTRAINT "ProposalSignature_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

