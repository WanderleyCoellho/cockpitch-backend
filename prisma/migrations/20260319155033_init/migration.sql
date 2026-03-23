-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('PROVIDER', 'CUSTOMER', 'ADMIN');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('ABERTA', 'FECHADA', 'EXPIRADA', 'ARQUIVADA');

-- CreateEnum
CREATE TYPE "CommercialStatus" AS ENUM ('SEM_RESPOSTA', 'NEGOCIANDO', 'ACEITA', 'NEGADA', 'PERSONALIZADO');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'PROVIDER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Provider" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "whatsapp" TEXT,
    "instagram" TEXT,
    "city" TEXT,
    "logoUrl" TEXT,
    "photoUrl" TEXT,
    "shortDescription" TEXT,
    "aboutTitle" TEXT,
    "aboutSubtitle" TEXT,
    "aboutText" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Provider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Package" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" TEXT NOT NULL,
    "isHighlighted" BOOLEAN NOT NULL DEFAULT false,
    "highlightLabel" TEXT,
    "highlightColor" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Package_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PackageItem" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isCourtesy" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PackageItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "serviceDate" TEXT,
    "validityDays" INTEGER NOT NULL DEFAULT 30,
    "status" "ProposalStatus" NOT NULL DEFAULT 'ABERTA',
    "commercialStatus" "CommercialStatus" NOT NULL DEFAULT 'SEM_RESPOSTA',
    "heroVideoUrl" TEXT,
    "weddingPhotoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalView" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "proposalSlug" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProposalView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_ProposalPackages" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ProposalPackages_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Provider_userId_idx" ON "Provider"("userId");

-- CreateIndex
CREATE INDEX "Package_providerId_idx" ON "Package"("providerId");

-- CreateIndex
CREATE INDEX "PackageItem_packageId_idx" ON "PackageItem"("packageId");

-- CreateIndex
CREATE UNIQUE INDEX "Proposal_slug_key" ON "Proposal"("slug");

-- CreateIndex
CREATE INDEX "Proposal_providerId_idx" ON "Proposal"("providerId");

-- CreateIndex
CREATE INDEX "Proposal_slug_idx" ON "Proposal"("slug");

-- CreateIndex
CREATE INDEX "ProposalView_proposalId_idx" ON "ProposalView"("proposalId");

-- CreateIndex
CREATE INDEX "ProposalView_proposalSlug_idx" ON "ProposalView"("proposalSlug");

-- CreateIndex
CREATE INDEX "_ProposalPackages_B_index" ON "_ProposalPackages"("B");

-- AddForeignKey
ALTER TABLE "Provider" ADD CONSTRAINT "Provider_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Package" ADD CONSTRAINT "Package_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PackageItem" ADD CONSTRAINT "PackageItem_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalView" ADD CONSTRAINT "ProposalView_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProposalPackages" ADD CONSTRAINT "_ProposalPackages_A_fkey" FOREIGN KEY ("A") REFERENCES "Package"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProposalPackages" ADD CONSTRAINT "_ProposalPackages_B_fkey" FOREIGN KEY ("B") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
