-- Biblioteca de blocos da empresa
CREATE TABLE "SavedBlock" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "block" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedBlock_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SavedBlock_workspaceId_createdAt_idx" ON "SavedBlock"("workspaceId", "createdAt");

ALTER TABLE "SavedBlock" ADD CONSTRAINT "SavedBlock_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
