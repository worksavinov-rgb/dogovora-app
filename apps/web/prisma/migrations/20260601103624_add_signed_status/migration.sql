-- AlterEnum
ALTER TYPE "VersionStatus" ADD VALUE 'SIGNED';

-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "signedAt" TIMESTAMP(3);
