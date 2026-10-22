-- AlterTable
ALTER TABLE "Proposal" ADD COLUMN     "blocks" JSONB,
ADD COLUMN     "blocksVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "templateId" TEXT;

-- CreateTable
CREATE TABLE "ProposalTemplate" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "segment" "WorkspaceSegment" NOT NULL DEFAULT 'GENERAL',
    "blocks" JSONB NOT NULL,
    "theme" TEXT,
    "themeCustom" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProposalTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProposalTemplate_workspaceId_idx" ON "ProposalTemplate"("workspaceId");

-- AddForeignKey
ALTER TABLE "ProposalTemplate" ADD CONSTRAINT "ProposalTemplate_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

