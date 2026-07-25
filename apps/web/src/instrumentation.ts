/**
 * Next.js instrumentation — поднимает файловый логгер на старте Node-runtime.
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'edge') return
  const { initLogger, getLogConfig } = await import('./lib/logger')
  const log = initLogger({ name: 'web', service: 'web' })
  const cfg = getLogConfig()
  log.info(
    `file logging ${cfg.toFile ? 'on' : 'off'}`,
    `dir=${cfg.logDir}`,
    `level=${cfg.level}`,
    `project=${cfg.project}`,
  )
}
