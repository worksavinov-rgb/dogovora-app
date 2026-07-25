/**
 * Smoke-проверка файлового логгера + JSON error-контракта.
 * Запуск: cd apps/web && npx tsx src/lib/logger.smoke.ts
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dogovora-logs-'))
  process.env.LOG_DIR = tmp
  process.env.LOG_TO_FILE = 'true'
  process.env.LOG_LEVEL = 'INFO'
  process.env.LOG_PROJECT = 'dogovora'
  process.env.LOG_SERVICE = 'web'
  process.env.LOG_ENV = 'test'
  process.env.LOG_MAX_BYTES = '1024'
  process.env.LOG_BACKUP_COUNT = '3'

  const { initLogger, getLogConfig, makeFingerprint } = await import('./logger')
  const log = initLogger({ name: 'smoke', patchConsole: false })
  const cfg = getLogConfig()

  if (!cfg.toFile) throw new Error('expected LOG_TO_FILE=true')
  if (path.basename(cfg.appLog) !== 'app.log') throw new Error('expected app.log')
  if (path.basename(cfg.errorLog) !== 'error.log') throw new Error('expected error.log')

  log.info('hello info')
  log.error({
    event: 'smoke.test_error',
    message: 'hello error 123',
    error: new Error('boom'),
    request_id: 'req-test',
  })

  const app = fs.readFileSync(cfg.appLog, 'utf8')
  const errRaw = fs.readFileSync(cfg.errorLog, 'utf8').trim()
  if (!app.includes('hello info')) throw new Error('app.log missing info line')
  if (!app.includes('smoke.test_error')) throw new Error('app.log missing event')

  const record = JSON.parse(errRaw)
  for (const key of [
    'ts',
    'level',
    'project',
    'service',
    'env',
    'event',
    'message',
    'error_type',
    'fingerprint',
    'request_id',
  ]) {
    if (!(key in record)) throw new Error(`error.log JSON missing ${key}`)
  }
  if (record.level !== 'ERROR') throw new Error('level must be ERROR')
  if (record.project !== 'dogovora') throw new Error('project mismatch')
  if (record.event !== 'smoke.test_error') throw new Error('event mismatch')
  if (record.request_id !== 'req-test') throw new Error('request_id mismatch')
  if (record.fingerprint !== makeFingerprint('smoke.test_error', 'Error', 'hello error 123')) {
    throw new Error('fingerprint mismatch')
  }
  if (errRaw.includes('hello info')) throw new Error('error.log must not contain info')

  // Ротация: пишем больше maxBytes
  for (let i = 0; i < 80; i += 1) {
    log.info(`pad-${i}-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`)
  }
  if (!fs.existsSync(`${cfg.appLog}.1`)) throw new Error('expected rotation to create app.log.1')

  fs.rmSync(tmp, { recursive: true, force: true })
  // eslint-disable-next-line no-console
  console.log('logger smoke OK')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
