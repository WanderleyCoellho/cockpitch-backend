-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "WorkspaceSegment" AS ENUM ('PHOTO_VIDEO', 'EVENTS', 'AGENCY', 'CONSULTING', 'HEALTH_BEAUTY', 'CONSTRUCTION', 'EDUCATION', 'TECH', 'GENERAL');

-- AlterTable
ALTER TABLE "Provider" ADD COLUMN     "workspaceId" TEXT;

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "segment" "WorkspaceSegment" NOT NULL DEFAULT 'GENERAL',
    "logoUrl" TEXT,
    "brandColor" TEXT,
    "locale" TEXT NOT NULL DEFAULT 'pt-BR',
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "planTier" "PlanTier" NOT NULL DEFAULT 'FREE',
    "billingStatus" "BillingStatus" NOT NULL DEFAULT 'INACTIVE',
    "licensePolicy" "LicensePolicy" NOT NULL DEFAULT 'STANDARD',
    "licensePolicyNote" TEXT,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMember" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceInvite" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL DEFAULT 'MEMBER',
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "invitedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_stripeCustomerId_key" ON "Workspace"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "WorkspaceMember_userId_idx" ON "WorkspaceMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMember_workspaceId_userId_key" ON "WorkspaceMember"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceInvite_tokenHash_key" ON "WorkspaceInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "WorkspaceInvite_workspaceId_idx" ON "WorkspaceInvite"("workspaceId");

-- CreateIndex
CREATE INDEX "Provider_workspaceId_idx" ON "Provider"("workspaceId");

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMember" ADD CONSTRAINT "WorkspaceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceInvite" ADD CONSTRAINT "WorkspaceInvite_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceInvite" ADD CONSTRAINT "WorkspaceInvite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Provider" ADD CONSTRAINT "Provider_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- =====================================================================
-- Migração de dados (aditiva): cada usuário existente vira dono do seu
-- próprio workspace, que herda o plano/cobrança do usuário.
-- Os campos de cobrança em "User" ficam congelados (legado).
-- =====================================================================
INSERT INTO "Workspace" (
    "id", "name", "slug", "segment",
    "planTier", "billingStatus", "licensePolicy", "licensePolicyNote",
    "stripeCustomerId", "stripeSubscriptionId", "createdAt", "updatedAt"
)
SELECT
    'ws_' || md5('workspace:' || u."id"),
    COALESCE(
        (SELECT p."name" FROM "Provider" p WHERE p."userId" = u."id" ORDER BY p."createdAt" ASC LIMIT 1),
        u."name"
    ),
    'w-' || substr(md5('slug:' || u."id"), 1, 12),
    'PHOTO_VIDEO',
    u."planTier", u."billingStatus", u."licensePolicy", u."licensePolicyNote",
    u."stripeCustomerId", u."stripeSubscriptionId", u."createdAt", CURRENT_TIMESTAMP
FROM "User" u;

INSERT INTO "WorkspaceMember" ("id", "workspaceId", "userId", "role", "createdAt")
SELECT 'wm_' || md5('member:' || u."id"), 'ws_' || md5('workspace:' || u."id"), u."id", 'OWNER', u."createdAt"
FROM "User" u;

UPDATE "Provider" p
SET "workspaceId" = 'ws_' || md5('workspace:' || p."userId")
WHERE p."workspaceId" IS NULL;
