import { prisma } from '@/lib/db'

// ─── Аудит входов ───────────────────────────────────────────────────────────────
// Серверный лог попыток входа/выхода для обнаружения и расследования атак.
// Запись не должна ломать сам вход — при ошибке только логируем в консоль.

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
    console.error('[audit] не удалось записать событие входа:', e)
  }
}
