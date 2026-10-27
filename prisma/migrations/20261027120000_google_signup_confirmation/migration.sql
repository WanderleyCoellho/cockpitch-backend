-- AlterTable
ALTER TABLE "User" ADD COLUMN     "sessionsValidAfter" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "GoogleSignupConfirmation" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "googleSub" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "userId" TEXT,
    "workspaceName" TEXT,
    "segment" "WorkspaceSegment",
    "inviteId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GoogleSignupConfirmation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GoogleSignupConfirmation_tokenHash_key" ON "GoogleSignupConfirmation"("tokenHash");

-- CreateIndex
CREATE INDEX "GoogleSignupConfirmation_email_idx" ON "GoogleSignupConfirmation"("email");

-- AddForeignKey
ALTER TABLE "GoogleSignupConfirmation" ADD CONSTRAINT "GoogleSignupConfirmation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
