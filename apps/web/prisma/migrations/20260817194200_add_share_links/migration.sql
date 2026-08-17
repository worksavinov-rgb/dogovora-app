-- Публичные read-only ссылки на версии документов («показать контрагенту»)
CREATE TABLE IF NOT EXISTS "share_links" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "share_links_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "share_links_token_key" ON "share_links"("token");
CREATE INDEX IF NOT EXISTS "share_links_versionId_idx" ON "share_links"("versionId");
ALTER TABLE "share_links" ADD CONSTRAINT "share_links_versionId_fkey"
  FOREIGN KEY ("versionId") REFERENCES "versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
