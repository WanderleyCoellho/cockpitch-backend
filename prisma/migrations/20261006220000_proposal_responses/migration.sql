-- CreateEnum
CREATE TYPE "ProposalResponseType" AS ENUM ('ACCEPTED', 'DECLINED', 'CHANGE_REQUESTED');

-- CreateTable
CREATE TABLE "ProposalResponse" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "type" "ProposalResponseType" NOT NULL,
    "signerName" TEXT NOT NULL,
    "signerEmail" TEXT NOT NULL,
    "signerDocument" TEXT,
    "message" TEXT,
    "selection" JSONB,
    "totalCents" INTEGER,
    "contentHash" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProposalResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProposalResponse_proposalId_createdAt_idx" ON "ProposalResponse"("proposalId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProposalResponse" ADD CONSTRAINT "ProposalResponse_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

