-- CreateEnum
CREATE TYPE "WorkspaceEventType" AS ENUM ('SUBSCRIBED', 'PLAN_CHANGED', 'PAYMENT_FAILED', 'PAYMENT_RECOVERED', 'CANCEL_SCHEDULED', 'CANCEL_REVERTED', 'CANCELED', 'COURTESY_GRANTED', 'COURTESY_REVOKED', 'LICENSE_CHANGED');

-- AlterTable
ALTER TABLE "Workspace" ADD COLUMN     "subscriptionCancelAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "WorkspaceEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "type" "WorkspaceEventType" NOT NULL,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StripeEventLog" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "customerId" TEXT,
    "outcome" TEXT NOT NULL,
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StripeEventLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkspaceEvent_workspaceId_createdAt_idx" ON "WorkspaceEvent"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkspaceEvent_type_createdAt_idx" ON "WorkspaceEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "StripeEventLog_receivedAt_idx" ON "StripeEventLog"("receivedAt");

-- AddForeignKey
ALTER TABLE "WorkspaceEvent" ADD CONSTRAINT "WorkspaceEvent_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

