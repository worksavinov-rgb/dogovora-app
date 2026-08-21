import { NextResponse } from 'next/server'
import { TOKEN_PACKAGES } from '@/lib/token-packages'

// GET /api/payments/packages — витрина пакетов для UI (без секретов).
export async function GET() {
  return NextResponse.json({
    packages: TOKEN_PACKAGES.map((p) => ({ id: p.id, tokens: p.tokens, priceRub: p.priceRub, label: p.label, badge: p.badge })),
  })
}
