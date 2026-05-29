-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ProfileType" ADD VALUE 'ANO';
ALTER TYPE "ProfileType" ADD VALUE 'PAO';
ALTER TYPE "ProfileType" ADD VALUE 'ZAO';

-- AlterTable
ALTER TABLE "versions" ADD COLUMN     "documentNumber" INTEGER,
ADD COLUMN     "formattedContent" TEXT,
ADD COLUMN     "formattingApplied" BOOLEAN DEFAULT false,
ADD COLUMN     "parentDocumentId" TEXT;

-- CreateTable
CREATE TABLE "document_templates" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_templates_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
