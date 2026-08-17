import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'

type Params = { params: Promise<{ id: string }> }

// POST /api/versions/:id/share — создать (или вернуть действующую) публичную
// ссылку на версию. Ссылка read-only, без логина; отзыв — DELETE.
export async function POST(req: NextRequest, { params }: Params) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const version = await prisma.version.findFirst({
    where: { id, document: { userId } },
    select: { id: true },
  })
  if (!version) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Одна активная ссылка на версию: повторный вызов возвращает её же,
  // а не плодит новые токены.
  const existing = await prisma.shareLink.findFirst({
    where: { versionId: id, revokedAt: null },
  })
  if (existing) {
    return NextResponse.json({ token: existing.token, createdAt: existing.createdAt })
  }

  const token = randomBytes(24).toString('base64url')
  const link = await prisma.shareLink.create({
    data: { token, versionId: id },
  })
  return NextResponse.json({ token: link.token, createdAt: link.createdAt }, { status: 201 })
}

// DELETE /api/versions/:id/share — отозвать все активные ссылки версии
export async function DELETE(req: NextRequest, { params }: Params) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const version = await prisma.version.findFirst({
    where: { id, document: { userId } },
    select: { id: true },
  })
  if (!version) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await prisma.shareLink.updateMany({
    where: { versionId: id, revokedAt: null },
    data: { revokedAt: new Date() },
  })
  return NextResponse.json({ ok: true })
}

// GET /api/versions/:id/share — состояние шаринга (есть ли активная ссылка)
export async function GET(req: NextRequest, { params }: Params) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const link = await prisma.shareLink.findFirst({
    where: { versionId: id, revokedAt: null, version: { document: { userId } } },
    select: { token: true, createdAt: true },
  })
  return NextResponse.json({ link })
}
