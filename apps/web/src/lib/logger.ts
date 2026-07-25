/**
 * Контракт технических логов dogovora:
 * - logs/app.log — INFO и выше (текст)
 * - logs/error.log — только ERROR (JSON Lines)
 * - ротация по размеру (по умолчанию 10 МБ × 10 бэкапов)
 *
 * Env: LOG_LEVEL, LOG_TO_FILE, LOG_DIR, LOG_MAX_BYTES, LOG_BACKUP_COUNT,
 *      LOG_PROJECT, LOG_SERVICE, LOG_ENV
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import util from 'node:util'
import { AsyncLocalStorage } from 'node:async_hooks'

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR'

/** Поля структурированной ошибки (error.log JSONL). */
export type LogEventInput = {
  /** Стабильный код: auth.login_error, worker.job_failed, ai.edit_failed */
  event: string
  message?: string
  error?: unknown
  request_id?: string
  job_id?: string | number
  user_id?: string
  org_id?: string
  /** Доп. поля без секретов / ПДн */
  [key: string]: unknown
}

export type ErrorLogRecord = {
  ts: string
  level: 'ERROR'
  project: string
  service: string
  env: string
  logger: string
  event: string
  message: string
  error_type: string
  stack: string | null
  fingerprint: string
  request_id: string | null
  job_id: string | null
  user_id?: string
  org_id?: string
}

type RequestContext = {
  request_id?: string
  user_id?: string
}

export const requestContext = new AsyncLocalStorage<RequestContext>()

const LEVEL_ORDER: Record<LogLevel, number> = {
  DEBUG: 10,
  INFO: 20,
  WARN: 30,
  ERROR: 40,
}

const originalConsole = {
  log: console.log.bind(console),
  info: console.info.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
  debug: console.debug.bind(console),
}

const SENSITIVE_KEY =
  /pass(word)?|secret|token|authorization|api[_-]?key|cookie|credential|refresh/i

function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name]
  if (raw == null || raw.trim() === '') return defaultValue
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase())
}

function envPositiveInt(name: string, defaultValue: number): number {
  const n = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(n) && n > 0 ? n : defaultValue
}

function parseLevel(raw: string | undefined): LogLevel {
  const value = (raw ?? 'INFO').trim().toUpperCase()
  if (value === 'DEBUG' || value === 'INFO' || value === 'WARN' || value === 'ERROR') return value
  if (value === 'WARNING') return 'WARN'
  return 'INFO'
}

function findRepoRoot(start: string): string | null {
  let dir = start
  for (let i = 0; i < 6; i += 1) {
    if (fs.existsSync(path.join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

function resolveLogDir(): string {
  const raw = (process.env.LOG_DIR ?? '').trim()
  if (raw) {
    return path.isAbsolute(raw) ? raw : path.resolve(process.cwd(), raw)
  }
  const repoRoot = findRepoRoot(process.cwd())
  if (repoRoot) return path.join(repoRoot, 'logs')
  return path.resolve(process.cwd(), 'logs')
}

/** Аналог logging.handlers.RotatingFileHandler */
class RotatingFileWriter {
  constructor(
    private readonly filePath: string,
    private readonly maxBytes: number,
    private readonly backupCount: number,
  ) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
  }

  write(chunk: string): void {
    const incoming = Buffer.byteLength(chunk, 'utf8')
    this.rotateIfNeeded(incoming)
    fs.appendFileSync(this.filePath, chunk, 'utf8')
  }

  private rotateIfNeeded(incoming: number): void {
    let size = 0
    try {
      size = fs.statSync(this.filePath).size
    } catch {
      return
    }
    if (size + incoming <= this.maxBytes) return

    for (let i = this.backupCount - 1; i >= 1; i -= 1) {
      const src = `${this.filePath}.${i}`
      const dest = `${this.filePath}.${i + 1}`
      if (!fs.existsSync(src)) continue
      try {
        fs.unlinkSync(dest)
      } catch {
        /* ignore */
      }
      if (i + 1 > this.backupCount) {
        try {
          fs.unlinkSync(src)
        } catch {
          /* ignore */
        }
      } else {
        fs.renameSync(src, dest)
      }
    }
    if (fs.existsSync(this.filePath)) {
      const dest = `${this.filePath}.1`
      try {
        fs.unlinkSync(dest)
      } catch {
        /* ignore */
      }
      fs.renameSync(this.filePath, dest)
    }
  }
}

function formatTimestamp(date = new Date()): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())},${pad(date.getMilliseconds(), 3)}`
  )
}

function formatArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === 'string') return arg
      if (arg instanceof Error) return arg.stack || arg.message
      return util.inspect(arg, { depth: 4, breakLength: 120 })
    })
    .join(' ')
}

/** Нормализация текста для fingerprint (без id/чисел/uuid). */
export function normalizeForFingerprint(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/\b[0-9a-f]{16,}\b/gi, '<hex>')
    .replace(/\b\d+\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
}

export function makeFingerprint(event: string, errorType: string, message: string): string {
  const basis = `${event}|${errorType}|${normalizeForFingerprint(message)}`
  return crypto.createHash('sha256').update(basis).digest('hex').slice(0, 16)
}

function extractError(err: unknown): { error_type: string; message: string; stack: string | null } {
  if (err instanceof Error) {
    return {
      error_type: err.name || 'Error',
      message: err.message || String(err),
      stack: err.stack ? err.stack.split('\n').slice(0, 20).join('\n') : null,
    }
  }
  if (typeof err === 'string') {
    return { error_type: 'Error', message: err, stack: null }
  }
  return {
    error_type: 'Error',
    message: util.inspect(err, { depth: 2, breakLength: 100 }).slice(0, 500),
    stack: null,
  }
}

function scrubExtra(extra: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(extra)) {
    if (SENSITIVE_KEY.test(key)) continue
    if (value == null) continue
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = typeof value === 'string' ? value.slice(0, 300) : value
    }
  }
  return out
}

function isLogEventInput(value: unknown): value is LogEventInput {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && 'event' in (value as object))
}

export type AppLogger = {
  debug: (...args: unknown[]) => void
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  /** Текстовый или структурированный ERROR (JSONL в error.log). */
  error: ((event: LogEventInput) => void) & ((...args: unknown[]) => void)
  child: (name: string) => AppLogger
}

type LoggerState = {
  level: LogLevel
  toFile: boolean
  logDir: string
  maxBytes: number
  backupCount: number
  project: string
  service: string
  env: string
  appWriter: RotatingFileWriter | null
  errorWriter: RotatingFileWriter | null
  consolePatched: boolean
  processHooks: boolean
}

const state: LoggerState = {
  level: parseLevel(process.env.LOG_LEVEL),
  toFile: envFlag('LOG_TO_FILE', true),
  logDir: resolveLogDir(),
  maxBytes: envPositiveInt('LOG_MAX_BYTES', 10 * 1024 * 1024),
  backupCount: envPositiveInt('LOG_BACKUP_COUNT', 10),
  project: (process.env.LOG_PROJECT || 'dogovora').trim() || 'dogovora',
  service: (process.env.LOG_SERVICE || 'web').trim() || 'web',
  env: (process.env.LOG_ENV || process.env.NODE_ENV || 'development').trim() || 'development',
  appWriter: null,
  errorWriter: null,
  consolePatched: false,
  processHooks: false,
}

function ensureWriters(): void {
  if (!state.toFile) return
  if (state.appWriter && state.errorWriter) return
  fs.mkdirSync(state.logDir, { recursive: true })
  state.appWriter = new RotatingFileWriter(
    path.join(state.logDir, 'app.log'),
    state.maxBytes,
    state.backupCount,
  )
  state.errorWriter = new RotatingFileWriter(
    path.join(state.logDir, 'error.log'),
    state.maxBytes,
    state.backupCount,
  )
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[state.level]
}

function emitToConsole(level: LogLevel, line: string): void {
  const text = line.trimEnd()
  if (level === 'ERROR') originalConsole.error(text)
  else if (level === 'WARN') originalConsole.warn(text)
  else if (level === 'DEBUG') originalConsole.debug(text)
  else originalConsole.log(text)
}

function writeText(level: LogLevel, name: string, message: string): void {
  if (!shouldLog(level)) return
  const line = `${formatTimestamp()} ${level} [${name}] ${message}\n`
  emitToConsole(level, line)
  if (!state.toFile) return
  try {
    ensureWriters()
    state.appWriter?.write(line)
  } catch (err) {
    originalConsole.error('[logger] failed to write app.log:', err)
  }
}

function writeErrorRecord(name: string, input: LogEventInput): void {
  if (!shouldLog('ERROR')) return

  const ctx = requestContext.getStore()
  const extracted = extractError(input.error)
  const message = (input.message || extracted.message || input.event).slice(0, 500)
  const errorType = extracted.error_type
  const event = String(input.event || 'unspecified')
  const requestId =
    (input.request_id as string | undefined) || ctx?.request_id || null
  const jobId = input.job_id != null ? String(input.job_id) : null
  const userId = (input.user_id as string | undefined) || ctx?.user_id
  const orgId = input.org_id as string | undefined

  const {
    event: _e,
    message: _m,
    error: _err,
    request_id: _r,
    job_id: _j,
    user_id: _u,
    org_id: _o,
    ...rest
  } = input

  const record: ErrorLogRecord & Record<string, unknown> = {
    ts: new Date().toISOString(),
    level: 'ERROR',
    project: state.project,
    service: state.service,
    env: state.env,
    logger: name,
    event,
    message,
    error_type: errorType,
    stack: extracted.stack,
    fingerprint: makeFingerprint(event, errorType, message),
    request_id: requestId,
    job_id: jobId,
    ...scrubExtra(rest as Record<string, unknown>),
  }
  if (userId) record.user_id = userId
  if (orgId) record.org_id = String(orgId)

  const textLine = `${formatTimestamp()} ERROR [${name}] event=${event} fp=${record.fingerprint} ${message}\n`
  emitToConsole('ERROR', textLine)

  if (!state.toFile) return
  try {
    ensureWriters()
    state.appWriter?.write(textLine)
    state.errorWriter?.write(`${JSON.stringify(record)}\n`)
  } catch (err) {
    originalConsole.error('[logger] failed to write error.log:', err)
  }
}

function createLogger(name: string): AppLogger {
  const errorFn = ((...args: unknown[]) => {
    if (args.length === 1 && isLogEventInput(args[0])) {
      writeErrorRecord(name, args[0])
      return
    }
    // Legacy: console-style → структурируем как unstructured
    const errArg = args.find((a) => a instanceof Error)
    const msg = formatArgs(args.filter((a) => a !== errArg))
    writeErrorRecord(name, {
      event: 'unstructured',
      message: msg || 'error',
      error: errArg ?? msg,
    })
  }) as AppLogger['error']

  return {
    debug: (...args) => writeText('DEBUG', name, formatArgs(args)),
    info: (...args) => writeText('INFO', name, formatArgs(args)),
    warn: (...args) => writeText('WARN', name, formatArgs(args)),
    error: errorFn,
    child: (childName) => createLogger(`${name}.${childName}`),
  }
}

function patchConsole(): void {
  if (state.consolePatched) return
  state.consolePatched = true

  console.log = (...args: unknown[]) => writeText('INFO', 'console', formatArgs(args))
  console.info = (...args: unknown[]) => writeText('INFO', 'console', formatArgs(args))
  console.warn = (...args: unknown[]) => writeText('WARN', 'console', formatArgs(args))
  console.debug = (...args: unknown[]) => writeText('DEBUG', 'console', formatArgs(args))
  console.error = (...args: unknown[]) => {
    const errArg = args.find((a) => a instanceof Error)
    const msg = formatArgs(args.filter((a) => a !== errArg))
    writeErrorRecord('console', {
      event: 'console.error',
      message: msg || 'console.error',
      error: errArg ?? msg,
    })
  }
}

function installProcessHooks(log: AppLogger): void {
  if (state.processHooks) return
  state.processHooks = true
  process.on('uncaughtException', (err) => {
    log.error({ event: 'process.uncaught_exception', error: err })
  })
  process.on('unhandledRejection', (reason) => {
    log.error({ event: 'process.unhandled_rejection', error: reason })
  })
}

export function getRequestIdFromHeaders(headers: Headers | { get(name: string): string | null }): string {
  return headers.get('x-request-id') || headers.get('X-Request-Id') || ''
}

export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return requestContext.run(ctx, fn)
}

/** Инициализация (идемпотентно). */
export function initLogger(options?: { name?: string; service?: string; patchConsole?: boolean }): AppLogger {
  state.level = parseLevel(process.env.LOG_LEVEL)
  state.toFile = envFlag('LOG_TO_FILE', true)
  state.logDir = resolveLogDir()
  state.maxBytes = envPositiveInt('LOG_MAX_BYTES', 10 * 1024 * 1024)
  state.backupCount = envPositiveInt('LOG_BACKUP_COUNT', 10)
  state.project = (process.env.LOG_PROJECT || 'dogovora').trim() || 'dogovora'
  state.service =
    (options?.service || process.env.LOG_SERVICE || options?.name || 'web').trim() || 'web'
  state.env = (process.env.LOG_ENV || process.env.NODE_ENV || 'development').trim() || 'development'
  state.appWriter = null
  state.errorWriter = null

  if (state.toFile) {
    try {
      ensureWriters()
    } catch (err) {
      originalConsole.error('[logger] cannot init file handlers:', err)
      state.toFile = false
    }
  }

  const log = createLogger(options?.name ?? 'app')
  if (options?.patchConsole !== false) patchConsole()
  installProcessHooks(log)
  return log
}

export function getLogConfig() {
  return {
    level: state.level,
    toFile: state.toFile,
    logDir: state.logDir,
    appLog: path.join(state.logDir, 'app.log'),
    errorLog: path.join(state.logDir, 'error.log'),
    maxBytes: state.maxBytes,
    backupCount: state.backupCount,
    project: state.project,
    service: state.service,
    env: state.env,
  }
}

export const logger = createLogger('app')
