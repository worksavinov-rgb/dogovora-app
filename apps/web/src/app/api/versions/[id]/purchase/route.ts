import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { calcVersionPrice } from '@/lib/pricing'

type Params = { params: Promise<{ id: string }> }

// POST /api/versions/:id/purchase — купить версию
// ACID: SELECT FOR UPDATE на кошелёк, идемпотентность по versionId
export async function POST(req: NextRequest, { params }: Params) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id: versionId } = await params

  // Проверяем что версия существует и принадлежит пользователю
  const version = await prisma.version.findFirst({
    where: { id: versionId, document: { userId } },
    include: { purchase: true, document: { select: { title: true, type: true } } },
  })
  if (!version) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Идемпотентность — уже куплено
  if (version.purchase) {
    const currentWallet = await prisma.wallet.findUnique({ where: { userId } })
    return NextResponse.json({
      purchase: {
        id: version.purchase.id,
        amount: Number(version.purchase.amount),
        purchasedAt: version.purchase.purchasedAt,
      },
      balance: Number(currentWallet?.balance ?? 0),
      alreadyPurchased: true,
    })
  }

  const chars = version.content?.length ?? 0
  const price = calcVersionPrice(version.document.type, chars)

  // Кошелёк (lazy init)
  const wallet = await prisma.wallet.upsert({
    where: { userId },
    create: { userId, balance: 0 },
    update: {},
  })

  // Проверка баланса
  if (Number(wallet.balance) < price) {
    return NextResponse.json(
      { error: 'Недостаточно средств', balance: Number(wallet.balance), required: price },
      { status: 402 },
    )
  }

  // ACID-транзакция: списание + создание Purchase + обновление статуса версии
  const [updatedWallet, purchase] = await prisma.$transaction(async (tx) => {
    // Настоящая блокировка строки кошелька: SELECT ... FOR UPDATE.
    // Параллельная покупка на том же кошельке ждёт, пока эта транзакция
    // не завершится, — баланс не может уйти в минус при гонке.
    const locked = await tx.$queryRaw<{ balance: string }[]>`
      SELECT balance FROM "wallets" WHERE id = ${wallet.id} FOR UPDATE
    `
    const lockedBalance = Number(locked[0]?.balance ?? 0)
    if (lockedBalance < price) {
      throw new Error('Insufficient funds')
    }

    const updatedWallet = await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: { decrement: price } },
    })

    await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: 'DEBIT',
        amount: price,
        description: `Покупка версии: ${version.document.title}`,
        relatedVersionId: versionId,
      },
    })

    const newPurchase = await tx.purchase.create({
      data: { versionId, amount: price },
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
    balance: Number(updatedWallet.balance),
    alreadyPurchased: false,
  }, { status: 201 })
}

// GET /api/versions/:id/purchase — проверить статус покупки
export async function GET(req: NextRequest, { params }: Params) {
  const userId = await getUserId(req)
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
