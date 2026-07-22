import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/admin-auth'
import { getUsageSummary } from '@/lib/ai/config/usage-logger'

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req)
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const period = (req.nextUrl.searchParams.get('period') ?? 'month') as 'day' | 'month' | 'all'
  const summary = await getUsageSummary(period)
  return NextResponse.json(summary)
}
