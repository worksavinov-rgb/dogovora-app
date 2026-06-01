-- AlterTable
ALTER TABLE "documents" ADD COLUMN     "documentNumber" INTEGER,
ADD COLUMN     "parentDocumentId" TEXT;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_parentDocumentId_fkey" FOREIGN KEY ("parentDocumentId") REFERENCES "documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
