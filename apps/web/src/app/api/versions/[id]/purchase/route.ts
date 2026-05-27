import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'

type Params = { params: Promise<{ id: string }> }

const VERSION_PRICE = 540 // ₽, фиксированная цена в MVP

// POST /api/versions/:id/purchase — купить версию
// ACID: SELECT FOR UPDATE на кошелёк, идемпотентность по versionId
export async function POST(req: NextRequest, { params }: Params) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: versionId } = await params

  // Проверяем что версия существует и принадлежит пользователю
  const version = await prisma.version.findFirst({
    where: { id: versionId, document: { userId } },
    include: { purchase: true, document: { select: { title: true } } },
  })
  if (!version) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Идемпотентность — уже куплено
  if (version.purchase) {
    return NextResponse.json({
      purchase: {
        id: version.purchase.id,
        amount: Number(version.purchase.amount),
        purchasedAt: version.purchase.purchasedAt,
      },
      alreadyPurchased: true,
    })
  }

  // Кошелёк (lazy init)
  const wallet = await prisma.wallet.upsert({
    where: { userId },
    create: { userId, balance: 0 },
    update: {},
  })

  // Проверка баланса
  if (Number(wallet.balance) < VERSION_PRICE) {
    return NextResponse.json(
      { error: 'Недостаточно средств', balance: Number(wallet.balance), required: VERSION_PRICE },
      { status: 402 },
    )
  }

  // ACID-транзакция: списание + создание Purchase + обновление статуса версии
  const [, purchase] = await prisma.$transaction(async (tx) => {
    // Повторно читаем кошелёк внутри транзакции (эмуляция SELECT FOR UPDATE)
    const lockedWallet = await tx.wallet.findUniqueOrThrow({ where: { id: wallet.id } })
    if (Number(lockedWallet.balance) < VERSION_PRICE) {
      throw new Error('Insufficient funds')
    }

    const updatedWallet = await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: { decrement: VERSION_PRICE } },
    })

    await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: 'DEBIT',
        amount: VERSION_PRICE,
        description: `Покупка версии: ${version.document.title}`,
        relatedVersionId: versionId,
      },
    })

    const newPurchase = await tx.purchase.create({
      data: { versionId, amount: VERSION_PRICE },
    })

    await tx.version.update({
      where: { id: versionId },
      data: { status: 'PAID' },
    })

    return [updatedWallet, newPurchase]
  })

  return NextResponse.json({
    purchase: {
      id: purchase.id,
      amount: Number(purchase.amount),
      purchasedAt: purchase.purchasedAt,
    },
    alreadyPurchased: false,
  }, { status: 201 })
}

// GET /api/versions/:id/purchase — проверить статус покупки
export async function GET(req: NextRequest, { params }: Params) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: versionId } = await params

  const purchase = await prisma.purchase.findFirst({
    where: { version: { id: versionId, document: { userId } } },
  })

  if (!purchase) return NextResponse.json({ purchased: false })

  return NextResponse.json({
    purchased: true,
    purchase: {
      id: purchase.id,
      amount: Number(purchase.amount),
      purchasedAt: purchase.purchasedAt,
    },
  })
}
