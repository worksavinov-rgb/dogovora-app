/**
 * BullMQ воркер — запускается отдельно от Next.js:
 *   pnpm worker   (или  npx tsx src/worker.ts)
 *
 * В продакшне — отдельный контейнер / PM2 процесс.
 */

import 'dotenv/config'
import { startGenerateWorker } from './lib/queue'

const worker = startGenerateWorker()
console.log('[worker] Started — listening for generate-document jobs')

process.on('SIGTERM', async () => {
  await worker.close()
  process.exit(0)
})

process.on('SIGINT', async () => {
  await worker.close()
  process.exit(0)
})
