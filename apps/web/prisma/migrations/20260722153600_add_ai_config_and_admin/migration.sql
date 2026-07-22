-- AlterTable
ALTER TABLE "users" ADD COLUMN "isAdmin" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ai_operators" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "credentials" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_operators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_task_routes" (
    "id" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "maxTokens" INTEGER,
    "providerPolicy" TEXT,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_task_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_usage_logs" (
    "id" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "promptTokens" INTEGER NOT NULL DEFAULT 0,
    "completionTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "costRub" DOUBLE PRECISION,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "versionId" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_operators_slug_key" ON "ai_operators"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ai_task_routes_task_key" ON "ai_task_routes"("task");

-- CreateIndex
CREATE INDEX "ai_usage_logs_createdAt_idx" ON "ai_usage_logs"("createdAt");

-- CreateIndex
CREATE INDEX "ai_usage_logs_task_idx" ON "ai_usage_logs"("task");

-- AddForeignKey
ALTER TABLE "ai_task_routes" ADD CONSTRAINT "ai_task_routes_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "ai_operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_usage_logs" ADD CONSTRAINT "ai_usage_logs_operatorId_fkey" FOREIGN KEY ("operatorId") REFERENCES "ai_operators"("id") ON DELETE CASCADE ON UPDATE CASCADE;
