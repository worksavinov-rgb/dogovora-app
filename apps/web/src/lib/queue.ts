import { Queue, Worker, Job } from 'bullmq'
import { prisma } from './db'
import { getAIProvider } from './ai/provider'

// ─── Redis-подключение для BullMQ ─────────────────────────────────────────────

const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6380'
const workerConcurrencyEnv = Number.parseInt(process.env['WORKER_CONCURRENCY'] ?? '', 10)
const workerConcurrency =
  Number.isFinite(workerConcurrencyEnv) && workerConcurrencyEnv > 0 ? workerConcurrencyEnv : 1

// Возвращаем connection options вместо экземпляра Redis, чтобы не ловить
// конфликты типов между версиями ioredis в зависимостях.
export function createRedisConnection() {
  const url = new URL(redisUrl)
  const isTls = url.protocol === 'rediss:'

  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username || undefined,
    password: url.password || undefined,
    tls: isTls ? {} : undefined,
    maxRetriesPerRequest: null, // обязательно для BullMQ
  }
}

// ─── Типы задач ───────────────────────────────────────────────────────────────

export interface GenerateDocumentJobData {
  versionId: string
  description: string
  counterpartyName: string
  protectionLevel: number
  targetSize: number
  customInstruction: string
}

// ─── Очередь ─────────────────────────────────────────────────────────────────

const QUEUE_NAME = 'generate-document'

let _queue: Queue | null = null

export function getGenerateQueue(): Queue {
  if (!_queue) {
    _queue = new Queue(QUEUE_NAME, {
      connection: createRedisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      },
    })
  }
  return _queue
}

// ─── Воркер (запускается отдельно, не в Next.js runtime) ─────────────────────

export function startGenerateWorker() {
  const worker = new Worker<GenerateDocumentJobData>(
    QUEUE_NAME,
    async (job: Job<GenerateDocumentJobData>) => {
      const { versionId, description, counterpartyName, protectionLevel, targetSize, customInstruction } = job.data

      // Обновляем статус версии → IN_PROGRESS
      await prisma.version.update({
        where: { id: versionId },
        data: { status: 'IN_PROGRESS' },
      })

      await job.updateProgress(10)

      // Стримим генерацию и собираем полный текст
      let fullText = ''
      const settings = { protectionLevel, targetSize, customInstruction }
      const aiProvider = getAIProvider()
      const generator = aiProvider.generate(description, counterpartyName, settings)

      for await (const chunk of generator) {
        fullText += chunk
        // Обновляем прогресс примерно каждые 100 символов
        if (fullText.length % 200 === 0) {
          const progress = Math.min(90, 10 + Math.floor((fullText.length / targetSize) * 80))
          await job.updateProgress(progress)
        }
      }

      // Сохраняем текст в БД (поле content в Version)
      await prisma.version.update({
        where: { id: versionId },
        data: {
          status: 'DRAFT',
          content: fullText.trim(),
          fileSize: Buffer.byteLength(fullText, 'utf8'),
        },
      })

      await job.updateProgress(100)
      return { versionId, chars: fullText.length }
    },
    {
      connection: createRedisConnection(),
      concurrency: workerConcurrency,
    },
  )

  worker.on('completed', (job) => {
    console.log(`[worker] Job ${job.id} completed: ${job.returnvalue?.chars} chars`)
  })

  worker.on('failed', (job, err) => {
    console.error(`[worker] Job ${job?.id} failed:`, err.message)
  })

  return worker
}
