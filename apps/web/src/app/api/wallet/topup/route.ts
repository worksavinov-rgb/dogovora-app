import { NextResponse } from 'next/server'

// POST /api/wallet/topup — устарел. Пополнение теперь через /api/payments/create
// (интернет-эквайринг Т-Банка). Оставлен для обратной совместимости старого фронта.
export async function POST() {
  return NextResponse.json(
    { error: 'Пополнение переехало. Обновите страницу баланса.', code: 'MOVED' },
    { status: 410 },
  )
}
