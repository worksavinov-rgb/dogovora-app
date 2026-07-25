import { Queue, Worker, Job } from 'bullmq'
import { prisma } from './db'
import { withLoggedAIContext } from './ai/provider'
import { saveFile, versionFileKey } from './storage'
import { DocumentFormatter } from '@shared/formatting/document-formatter'
import { sanitizeHtml, normalizeLegalHtml, buildRequisitesHtml, isHtmlContent, stripAiRequisitesBlock, buildContractPreambleHtml, stripAiPreamble } from './html-document'
import type { CounterpartyData, UserProfileData } from './ai/types'
import { anonymizeForAnalysis, maskPartyForAI } from './anonymize'
import { logger } from './logger'

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
  docType?: string            // CONTRACT | APPENDIX | AMENDMENT
  docNumber?: string          // номер документа (введённый пользователем)
  signingDate?: string        // плановая дата подписания (ISO string)
  documentNumber?: number     // порядковый номер приложения/ДС (1, 2, 3...)
  parentDocTitle?: string     // название родительского договора
  parentDocNumber?: string    // номер родительского договора
  parentDocContent?: string   // текст финальной версии родительского договора
  referenceContent?: string   // образец структуры (шаблон/файл)
  base?: string               // 'scratch' | 'template' | 'upload'
  userRole?: 'customer' | 'executor'   // роль пользователя в договоре
  userProfile?: UserProfileData        // профиль пользователя (одна из сторон)
  counterpartyData?: CounterpartyData  // полные данные контрагента
  // Замороженные на шаге настройки документа HTML-блоки (см. Document.preambleHtml/
  // requisitesHtml) — если заданы, подставляются как есть вместо пересчёта из
  // userProfile/counterpartyData. Это сохраняет шапку/реквизиты стабильными даже
  // если пользователь позже изменит реквизиты в карточке профиля/контрагента.
  preambleHtml?: string
  requisitesHtml?: string
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
      const {
        versionId, description, counterpartyName, protectionLevel, targetSize, customInstruction,
        docType, docNumber, signingDate, documentNumber, parentDocTitle, parentDocNumber, parentDocContent,
        referenceContent, base, userRole, userProfile, counterpartyData,
        preambleHtml: frozenPreambleHtml, requisitesHtml: frozenRequisitesHtml,
      } = job.data

      // Обновляем статус версии → IN_PROGRESS
      await prisma.version.update({
        where: { id: versionId },
        data: { status: 'IN_PROGRESS' },
      })

      await job.updateProgress(10)

      // Форматируем дату подписания для промпта и форматтера
      const signingDateFormatted = signingDate
        ? new Date(signingDate).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
        : null

      // Если это приложение/ДС с привязкой к родительскому договору — добавляем в описание
      let enrichedDescription = description
      if (docType === 'APPENDIX' && parentDocTitle) {
        const numStr = documentNumber ? ` № ${documentNumber}` : ''
        const parentRef = parentDocNumber ? `"${parentDocTitle}" № ${parentDocNumber}` : `"${parentDocTitle}"`
        enrichedDescription = `[Тип документа: Приложение${numStr} к договору ${parentRef}]\n${description}`
      } else if (docType === 'AMENDMENT' && parentDocTitle) {
        const numStr = documentNumber ? ` № ${documentNumber}` : ''
        const parentRef = parentDocNumber ? `"${parentDocTitle}" № ${parentDocNumber}` : `"${parentDocTitle}"`
        enrichedDescription = `[Тип документа: Дополнительное соглашение${numStr} к договору ${parentRef}]\n${description}`
      }

      // Добавляем номер и дату подписания в промпт чтобы ИИ вставил их в шапку документа
      const metaLines: string[] = []
      if (docNumber) metaLines.push(`Номер договора: ${docNumber}`)
      if (signingDateFormatted) metaLines.push(`Дата подписания: ${signingDateFormatted}`)
      if (metaLines.length > 0) {
        enrichedDescription = `[${metaLines.join(', ')}]\n${enrichedDescription}`
      }

      // Стримим генерацию и собираем полный текст
      let fullText = ''
      const settings = { protectionLevel, targetSize, customInstruction }
      const cityFromProfile = userProfile?.legalAddress
        ? (userProfile.legalAddress.match(/(?:г\.|город)\s+([А-Яа-яЁё\-]+)/i)?.[1] ?? null)
        : null
      const contractCity = cityFromProfile ?? 'Москва'
      // В ИИ уходят маскированные реквизиты; шапка/подвал собираются на сервере из полных данных.
      const aiUserProfile = maskPartyForAI(userProfile as unknown as Record<string, unknown>) as unknown as UserProfileData | undefined
      const aiCounterparty = maskPartyForAI(counterpartyData as unknown as Record<string, unknown>) as unknown as CounterpartyData | undefined
      const aiParent = parentDocContent ? anonymizeForAnalysis(parentDocContent) : parentDocContent
      const aiReference = referenceContent ? anonymizeForAnalysis(referenceContent) : referenceContent
      await withLoggedAIContext('generate', { versionId }, async ({ provider }) => {
        const generator = provider.generate(
          enrichedDescription,
          counterpartyName,
          settings,
          aiUserProfile,
          aiCounterparty,
          aiParent,
          aiReference,
          base,
          userRole,
          contractCity,
          signingDate,
        )
        for await (const chunk of generator) {
          fullText += chunk
          if (fullText.length % 200 === 0) {
            const progress = Math.min(90, 10 + Math.floor((fullText.length / targetSize) * 80))
            await job.updateProgress(progress)
          }
        }
      })

      // ── Sanitize + normalize HTML ──────────────────────────────────────────
      // AI теперь возвращает HTML. Очищаем и нормализуем перед сохранением.
      let finalText = fullText.trim()
      if (isHtmlContent(finalText)) {
        finalText = normalizeLegalHtml(sanitizeHtml(finalText))
      }

      // ── Блок реквизитов (ТОЛЬКО для основных договоров CONTRACT) ───────────
      const isMainContract = !docType || docType === 'CONTRACT'
      if (isMainContract && userProfile && counterpartyData) {
        const role1 = userRole === 'executor' ? 'Исполнитель' : 'Заказчик'
        const role2 = userRole === 'executor' ? 'Заказчик' : 'Исполнитель'

        // Удаляем если ИИ всё-таки написал блок реквизитов сам (HTML или Markdown).
        // stripAiRequisitesBlock ищет по реальному тексту абзаца, а не по конкретной
        // разметке — надёжнее старой цепочки regex, которая ловила не все варианты
        // оформления и приводила к дублированию реквизитов (старый блок ИИ + наш).
        finalText = stripAiRequisitesBlock(finalText)
          // Вариант: Markdown (на случай если ИИ вернул не HTML)
          .replace(/\n*\*{0,2}(?:РЕКВИЗИТЫ|Реквизиты|ПОДПИСИ СТОРОН|Подписи сторон|Заказчик\s*:|Исполнитель\s*:)[\s\S]*$/i, '')
          .trimEnd()

        // Удаляем преамбулу, если ИИ всё-таки написал её сам (вопреки инструкции
        // «преамбулу не пиши — вставляется системой») — и подставляем детерминированную,
        // собранную из тех же данных профиля/контрагента, что и реквизиты в подвале.
        finalText = stripAiPreamble(finalText)
        // Если шапка/реквизиты были заморожены на шаге настройки документа — используем
        // их как есть. Иначе (старые документы, созданные до этой фичи) — собираем
        // на лету из текущих данных профиля/контрагента, как раньше.
        const preambleHtml = frozenPreambleHtml ?? buildContractPreambleHtml(userProfile, counterpartyData, role1, role2, contractCity, signingDate)
        finalText = `${preambleHtml}\n${finalText}`

        // Добавляем HTML-блок реквизитов
        const reqsHtml = frozenRequisitesHtml ?? buildRequisitesHtml(userProfile, counterpartyData, role1, role2)
        finalText += `\n${reqsHtml}`
      }

      // Сохраняем текст в БД (поле content в Version)
      const trimmedText = finalText
      const fileSize = Buffer.byteLength(trimmedText, 'utf8')

      await job.updateProgress(92)

      // Применяем форматирование
      try {
        const city = contractCity

        // Номер договора: для дочерних берём из родителя, для основных — из doc.number
        const contractNumber = parentDocNumber
          ? `${documentNumber ?? ''} к дог. № ${parentDocNumber}`.trim()
          : (docNumber ?? '')

        // Дата: плановая дата подписания если указана, иначе сегодня
        const contractDate = signingDate
          ? new Date(signingDate).toLocaleDateString('ru-RU')
          : new Date().toLocaleDateString('ru-RU')

        const formattedBuffer = await DocumentFormatter.formatDocument(trimmedText, {
          contractNumber,
          contractDate,
          city,
        })

        // Форматированный DOCX пишем в файловое хранилище, в БД — только путь
        const formattedKey = versionFileKey(versionId, 'formatted.docx')
        await saveFile(formattedKey, formattedBuffer)

        await prisma.version.update({
          where: { id: versionId },
          data: {
            status: 'DRAFT',
            content: trimmedText,
            fileSize: fileSize,
            formattingApplied: true,
          },
        })
      } catch (formatError) {
        console.warn(`[worker] Failed to format document ${versionId}:`, formatError)
        // Сохраняем без форматирования, чтобы не блокировать генерацию
        await prisma.version.update({
          where: { id: versionId },
          data: {
            status: 'DRAFT',
            content: trimmedText,
            fileSize: fileSize,
            formattingApplied: false,
          },
        })
      }

      await job.updateProgress(100)
      return { versionId, chars: trimmedText.length }
    },
    {
      connection: createRedisConnection(),
      concurrency: workerConcurrency,
    },
  )

  worker.on('completed', (job) => {
    logger.info(`Job ${job.id} completed: ${job.returnvalue?.chars} chars`)
  })

  worker.on('failed', (job, err) => {
    logger.error({
      event: 'worker.job_failed',
      error: err,
      job_id: job?.id,
      version_id: job?.data?.versionId,
    })
  })

  return worker
}
