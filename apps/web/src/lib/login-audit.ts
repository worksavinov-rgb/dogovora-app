import { prisma } from '@/lib/db'
import { logger } from '@/lib/logger'

// ─── Аудит входов ───────────────────────────────────────────────────────────────
// Серверный лог попыток входа/выхода для обнаружения и расследования атак.
// Запись не должна ломать сам вход — при ошибке только логируем.

export type AuditResult = 'SUCCESS' | 'FAIL' | 'LOCKED' | 'LOGOUT'

export async function recordLoginAudit(params: {
  email: string
  userId?: string | null
  ip?: string | null
  userAgent?: string | null
  result: AuditResult
}): Promise<void> {
  try {
    await prisma.loginAudit.create({
      data: {
        email: params.email.trim().toLowerCase(),
        userId: params.userId ?? null,
        ip: params.ip ?? null,
        userAgent: params.userAgent ?? null,
        result: params.result,
      },
    })
  } catch (e) {
    logger.error({ event: 'auth.audit_write_failed', error: e })
  }
}
