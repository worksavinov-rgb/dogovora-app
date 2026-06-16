import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { sep } from 'node:path'
import { z } from 'zod'
import type { AIMessage, AIProvider, AISettings, ReviewResult } from './types'
import { splitHtmlBlocks, blocksToPromptText, parseBlockOps, applyBlockOps, BLOCK_EDIT_INSTRUCTION } from '../doc-blocks'

const CODEX_CLI_COMMAND = process.env['CODEX_CLI_COMMAND'] ?? 'codex'
const CODEX_MODEL = process.env['CODEX_MODEL'] ?? ''
const CODEX_PROFILE = process.env['CODEX_PROFILE'] ?? ''
const CODEX_WORKDIR = process.env['CODEX_WORKDIR'] ?? ''
const CODEX_TIMEOUT_MS = Number.parseInt(process.env['CODEX_TIMEOUT_MS'] ?? '', 10) || 180_000

const reviewSchema = z.object({
  score: z.number().min(0).max(100),
  summary: z.string().min(1),
  issues: z.array(
    z.object({
      id: z.union([z.string(), z.number()]),
      severity: z.enum(['risk', 'warning', 'ok']),
      title: z.string().min(1),
      description: z.string().min(1),
      clause: z.string().min(1),
    }),
  ),
})

function buildBaseInstruction(settings: AISettings): string {
  return [
    'Ты юридический помощник для подготовки договоров на русском языке.',
    'Работай только с текстом, который передан в запросе.',
    'Не запускай команды, не читай файлы проекта, не меняй файлы на диске.',
    'Пиши практично и без лишних пояснений.',
    `Уровень защиты интересов пользователя: ${settings.protectionLevel}/90.`,
    `Целевой объём текста: примерно ${settings.targetSize} знаков.`,
    settings.customInstruction ? `Дополнительная инструкция: ${settings.customInstruction}` : '',
  ].filter(Boolean).join('\n')
}

function buildCodexArgs(outputPath: string): string[] {
  const args = [
    'exec',
    '--ephemeral',
    '--ignore-rules',
    '--color',
    'never',
    '--sandbox',
    'read-only',
    '-c',
    'approval_policy="never"',
    '--output-last-message',
    outputPath,
  ]

  if (CODEX_WORKDIR) args.push('-C', CODEX_WORKDIR)
  if (CODEX_MODEL) args.push('-m', CODEX_MODEL)
  if (CODEX_PROFILE) args.push('-p', CODEX_PROFILE)

  args.push('-')
  return args
}

async function runCodex(prompt: string): Promise<string> {
  const tempDir = await mkdtemp(`${tmpdir()}${sep}dogovora-codex-`)
  const outputPath = `${tempDir}${sep}${randomUUID()}.txt`

  try {
    const result = await new Promise<{ code: number | null; stderr: string }>((resolve, reject) => {
      // На Windows CLI ставится как .cmd-шим (codex.cmd). Node 22 не умеет
      // запускать .cmd без shell (ищет файл ровно "codex" → ENOENT), поэтому
      // на Windows запускаем через shell — как при вызове codex из терминала.
      const child = spawn(CODEX_CLI_COMMAND, buildCodexArgs(outputPath), {
        cwd: CODEX_WORKDIR || undefined,
        env: process.env,
        windowsHide: true,
        shell: process.platform === 'win32',
      })

      let stderr = ''
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error(`Codex CLI timed out after ${CODEX_TIMEOUT_MS}ms`))
      }, CODEX_TIMEOUT_MS)

      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => {
        stderr += chunk
      })
      child.on('error', (err) => {
        clearTimeout(timeout)
        reject(err)
      })
      child.on('close', (code) => {
        clearTimeout(timeout)
        resolve({ code, stderr })
      })

      child.stdin.end(prompt)
    })

    if (result.code !== 0) {
      throw new Error(`Codex CLI failed with code ${result.code}: ${result.stderr.trim()}`)
    }

    return (await readFile(outputPath, 'utf8')).trim()
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function* streamText(text: string): AsyncGenerator<string> {
  const chunkSize = 160
  for (let index = 0; index < text.length; index += chunkSize) {
    yield text.slice(index, index + chunkSize)
  }
}

function stripMarkdownFence(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:\w+)?\s*([\s\S]*?)\s*```$/)
  return fenced?.[1]?.trim() ?? trimmed
}

function extractJson(text: string): string {
  const stripped = stripMarkdownFence(text)
  const start = stripped.indexOf('{')
  const end = stripped.lastIndexOf('}')
  if (start !== -1 && end !== -1 && end > start) return stripped.slice(start, end + 1)
  return stripped
}

function normalizeReview(raw: unknown): ReviewResult {
  const parsed = reviewSchema.parse(raw)
  const issues = parsed.issues.map((issue) => ({
    id: String(issue.id),
    severity: issue.severity,
    importance: (issue as { importance?: 'high' | 'medium' | 'low' }).importance ?? 'medium' as const,
    title: issue.title,
    description: issue.description,
    clause: issue.clause,
    recommendation: (issue as { recommendation?: string }).recommendation,
    category: (issue as { category?: string }).category,
  }))

  return {
    score: Math.round(parsed.score),
    summary: parsed.summary,
    spellCount: (parsed as { spellCount?: number }).spellCount ?? 0,
    issues,
    riskCount: issues.filter((issue) => issue.severity === 'risk').length,
    warningCount: issues.filter((issue) => issue.severity === 'warning').length,
    okCount: issues.filter((issue) => issue.severity === 'ok').length,
  }
}

export const codexProvider: AIProvider = {
  async *chat(messages: AIMessage[], settings: AISettings, documentText: string) {
    const conversation = messages
      .filter((message) => message.role === 'user' || message.role === 'assistant')
      .map((message) => `${message.role === 'user' ? 'Пользователь' : 'Ассистент'}: ${message.content}`)
      .join('\n\n')

    const prompt = [
      buildBaseInstruction(settings),
      '',
      'Ответь на последний вопрос пользователя. Не изменяй документ.',
      '',
      'Текущий текст документа:',
      documentText || '(документ пуст)',
      '',
      'История диалога:',
      conversation || '(истории нет)',
    ].join('\n')

    yield* streamText(await runCodex(prompt))
  },

  async *editDocument(documentText: string, instruction: string, settings: AISettings) {
    const blocks = splitHtmlBlocks(documentText)

    const prompt = [
      buildBaseInstruction(settings),
      '',
      'Задача: применить инструкцию пользователя к договору.',
      'Если инструкция просит заменить или указать сторону "везде", проверь преамбулу, реквизиты, подписи, приложения и все шаблонные плейсхолдеры.',
      '',
      BLOCK_EDIT_INSTRUCTION,
      '',
      `Инструкция пользователя: ${instruction}`,
      '',
      'Документ (пронумерованные блоки):',
      blocksToPromptText(blocks) || '(документ пуст)',
    ].join('\n')

    const aiResponse = stripMarkdownFence(await runCodex(prompt))
    const ops = parseBlockOps(aiResponse)
    const { html, applied, rejected, errors } = applyBlockOps(blocks, ops)
    console.log(`[codex editDocument] ops=${ops.length} applied=${applied} rejected=${rejected}`, errors)

    if (applied === 0) {
      yield '__EDIT_FAILED__'
      return
    }

    yield* streamText(html)
  },

  async review(documentText: string, settings: AISettings): Promise<ReviewResult> {
    const prompt = [
      buildBaseInstruction(settings),
      '',
      'Проверь договор на юридические риски.',
      'Верни только валидный JSON без markdown.',
      'Формат:',
      '{"score":72,"summary":"...","issues":[{"id":"1","severity":"risk|warning|ok","title":"...","description":"...","clause":"п. 3.2"}]}',
      '',
      'Текст договора:',
      documentText || '(документ пуст)',
    ].join('\n')

    const content = await runCodex(prompt)
    return normalizeReview(JSON.parse(extractJson(content)))
  },

  async *generate(description: string, counterpartyName: string, settings: AISettings) {
    const prompt = [
      buildBaseInstruction(settings),
      '',
      `Сгенерируй проект договора с контрагентом "${counterpartyName}".`,
      'Верни только текст договора без markdown и пояснений.',
      `Описание задачи: ${description || 'не указано'}.`,
      'Язык: русский.',
    ].join('\n')

    yield* streamText(stripMarkdownFence(await runCodex(prompt)))
  },

  async extractParties(documentText: string) {
    const prompt = [
      'Извлеки реквизиты обеих сторон договора и верни строго в формате JSON:',
      '{"docTitle":null,"party1":{"name":"","type":null,"inn":null,"kpp":null,"ogrn":null,"legalAddress":null,"bankName":null,"bik":null,"checkingAccount":null,"correspondentAccount":null,"signatorName":null,"signatorPosition":null,"signatorBasis":null},"party2":{...}}',
      'Если реквизит не найден — ставь null. Не придумывай данные.',
      '',
      'Текст договора:',
      documentText.slice(0, 6000),
    ].join('\n')

    const content = await runCodex(prompt)
    const raw = JSON.parse(extractJson(content))
    return {
      docTitle: raw.docTitle ?? null,
      party1: raw.party1 ?? { name: 'Сторона 1' },
      party2: raw.party2 ?? { name: 'Сторона 2' },
    }
  },
}
