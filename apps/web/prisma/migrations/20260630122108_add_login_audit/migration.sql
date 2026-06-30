-- CreateTable
CREATE TABLE "login_audits" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "userId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "result" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_audits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "login_audits_email_createdAt_idx" ON "login_audits"("email", "createdAt");

-- CreateIndex
CREATE INDEX "login_audits_userId_createdAt_idx" ON "login_audits"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "login_audits_createdAt_idx" ON "login_audits"("createdAt");

