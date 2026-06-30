import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { hashPassword, comparePassword } from '@/lib/auth'
import { getUserId } from '@/lib/api-auth'

export async function GET(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, fullName: true, businessScope: true, createdAt: true, wallet: { select: { balance: true } } },
  })
  if (!user) return NextResponse.json({ error: 'Пользователь не найден' }, { status: 404 })

  return NextResponse.json({ user })
}

export async function PATCH(req: NextRequest) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Не авторизован' }, { status: 401 })

  const body = await req.json() as { fullName?: string; email?: string; currentPassword?: string; newPassword?: string }

  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) return NextResponse.json({ error: 'Не найден' }, { status: 404 })

  const updateData: { fullName?: string; email?: string; passwordHash?: string } = {}

  if (body.fullName !== undefined) updateData.fullName = body.fullName.trim()

  if (body.email !== undefined && body.email !== user.email) {
    const exists = await prisma.user.findUnique({ where: { email: body.email } })
    if (exists) return NextResponse.json({ error: 'Этот email уже занят' }, { status: 409 })
    updateData.email = body.email.trim().toLowerCase()
  }

  if (body.newPassword) {
    if (!body.currentPassword) return NextResponse.json({ error: 'Введите текущий пароль' }, { status: 400 })
    const ok = await comparePassword(body.currentPassword, user.passwordHash)
    if (!ok) return NextResponse.json({ error: 'Неверный текущий пароль' }, { status: 400 })
    if (body.newPassword.length < 8) return NextResponse.json({ error: 'Пароль должен быть не менее 8 символов' }, { status: 400 })
    updateData.passwordHash = await hashPassword(body.newPassword)
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: updateData,
    select: { id: true, email: true, fullName: true, createdAt: true },
  })

  return NextResponse.json({ user: updated })
}
