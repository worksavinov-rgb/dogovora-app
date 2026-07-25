/**
 * BullMQ воркер — запускается отдельно от Next.js:
 *   pnpm worker   (или  npx tsx src/worker.ts)
 *
 * В продакшне — отдельный контейнер / PM2 процесс.
 */

import 'dotenv/config'
import { getLogConfig, initLogger } from './lib/logger'
import { startGenerateWorker } from './lib/queue'

const log = initLogger({ name: 'worker', service: 'worker' })
const logCfg = getLogConfig()
log.info(
  `file logging ${logCfg.toFile ? 'on' : 'off'}`,
  `dir=${logCfg.logDir}`,
  `level=${logCfg.level}`,
  `project=${logCfg.project}`,
)

const worker = startGenerateWorker()
log.info('Started — listening for generate-document jobs')

process.on('SIGTERM', async () => {
  await worker.close()
  process.exit(0)
})

process.on('SIGINT', async () => {
  await worker.close()
  process.exit(0)
})
