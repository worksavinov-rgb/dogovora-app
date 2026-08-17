-- AlterTable
ALTER TABLE "profiles" ADD COLUMN     "contractNumberFormat" TEXT;

-- CreateIndex
CREATE INDEX "documents_userId_profileId_number_idx" ON "documents"("userId", "profileId", "number");
