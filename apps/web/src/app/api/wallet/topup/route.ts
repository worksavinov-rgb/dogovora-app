import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/api-auth'
import { logger } from '@/lib/logger'

// POST /api/wallet/topup — пополнение баланса.
// ОТКЛЮЧЕНО до подключения платёжного шлюза: раньше любой авторизованный
// пользователь мог начислить себе до 1 000 000 ₽ одним запросом.
// Бонус при регистрации начисляется отдельно (auth/register), баланс тратится
// на покупку версий. Реальное пополнение появится вместе с платёжным шлюзом.
export async function POST(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Фиксируем попытки в лог — интерес к пополнению полезно видеть.
  logger.info({ event: 'wallet.topup_attempt_while_disabled', user_id: userId })

  return NextResponse.json(
    { error: 'Пополнение баланса появится после подключения платёжного шлюза. Пока пользование сервисом бесплатное — стартового баланса достаточно.' },
    { status: 503 },
  )
}
