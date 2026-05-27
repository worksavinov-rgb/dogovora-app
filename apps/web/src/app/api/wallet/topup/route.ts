import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'

const schema = z.object({
  amount: z.number().positive().max(1_000_000),
  description: z.string().optional(),
})

// POST /api/wallet/topup — пополнение баланса
// В MVP любой авторизованный пользователь может пополнить свой баланс
// (в продакшне будет через платёжный шлюз)
export async function POST(req: NextRequest) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  let data: z.infer<typeof schema>
  try {
    data = schema.parse(body)
  } catch (err: unknown) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0]?.message }, { status: 400 })
    throw err
  }

  // Создаём кошелёк если не существует
  const wallet = await prisma.wallet.upsert({
    where: { userId },
    create: { userId, balance: 0 },
    update: {},
  })

  // ACID: обновляем баланс + создаём транзакцию атомарно
  const [updatedWallet, transaction] = await prisma.$transaction([
    prisma.wallet.update({
      where: { id: wallet.id },
      data: { balance: { increment: data.amount } },
    }),
    prisma.transaction.create({
      data: {
        walletId: wallet.id,
        type: 'CREDIT',
        amount: data.amount,
        description: data.description ?? `Пополнение баланса на ${data.amount} ₽`,
      },
    }),
  ])

  return NextResponse.json({
    balance: Number(updatedWallet.balance),
    transaction: {
      id: transaction.id,
      amount: Number(transaction.amount),
      createdAt: transaction.createdAt,
    },
  }, { status: 201 })
}
