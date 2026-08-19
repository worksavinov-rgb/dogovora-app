import { NextResponse } from 'next/server'
import type { ChargeKind } from '@prisma/client'
import { prisma } from './db'
import { calcEditLimit, formatTokens } from './token-pricing'

export class InsufficientTokensError extends Error {
  constructor(public balance: number, public required: number) {
    super('INSUFFICIENT_TOKENS')
  }
}

const PACKAGE_KINDS: ChargeKind[] = ['GENERATE', 'UPLOAD_EDIT_START', 'REWRITE', 'EDIT_PACKAGE']

/**
 * Списание токенов. ACID: SELECT ... FOR UPDATE на кошелёк (паттерн из бывшего
 * purchase) — параллельные списания сериализуются, баланс не уходит в минус.
 * Проверки идемпотентности выполняются ВНУТРИ транзакции, после блокировки
 * кошелька: параллельные списания одного пользователя ждут друг друга, поэтому
 * второй запрос гарантированно видит charge первого.
 * idempotentPerDocument: одно неотменённое списание kind на документ (GENERATE, UPLOAD_EDIT_START).
 * idempotentPerVersion: одно неотменённое списание kind на версию (REWRITE).
 */
export async function chargeTokens(opts: {
  userId: string
  kind: ChargeKind
  tokens: number
  description: string
  documentId?: string | null
  versionId?: string | null
  idempotentPerDocument?: boolean
  idempotentPerVersion?: boolean
}): Promise<{ chargeId: string; balance: number; alreadyCharged: boolean }> {
  const wallet = await prisma.wallet.upsert({
    where: { userId: opts.userId },
    create: { userId: opts.userId, balance: 0 },
    update: {},
  })

  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ balance: string }[]>`
      SELECT balance FROM "wallets" WHERE id = ${wallet.id} FOR UPDATE
    `
    const balance = Number(locked[0]?.balance ?? 0)

    if (opts.idempotentPerDocument && opts.documentId) {
      const existing = await tx.tokenCharge.findFirst({
        where: { documentId: opts.documentId, kind: opts.kind, refundedAt: null },
      })
      if (existing) return { chargeId: existing.id, balance, alreadyCharged: true }
    }
    if (opts.idempotentPerVersion && opts.versionId) {
      const existing = await tx.tokenCharge.findFirst({
        where: { versionId: opts.versionId, kind: opts.kind, refundedAt: null },
      })
      if (existing) return { chargeId: existing.id, balance, alreadyCharged: true }
    }

    if (balance < opts.tokens) {
      throw new InsufficientTokensError(balance, opts.tokens)
    }

    const updated = await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: { decrement: opts.tokens } },
    })
    await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: 'DEBIT',
        amount: opts.tokens,
        currency: 'TOKEN',
        description: opts.description,
        relatedVersionId: opts.versionId ?? null,
      },
    })
    const charge = await tx.tokenCharge.create({
      data: {
        userId: opts.userId,
        documentId: opts.documentId ?? null,
        versionId: opts.versionId ?? null,
        kind: opts.kind,
        tokens: opts.tokens,
      },
    })
    return { chargeId: charge.id, balance: Number(updated.balance), alreadyCharged: false }
  })
}

/** Возврат списания (генерация упала и т.п.). Идемпотентен. */
export async function refundChargeById(chargeId: string, reason: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    // updateMany с условием refundedAt: null — защита от двойного возврата при гонке
    const res = await tx.tokenCharge.updateMany({
      where: { id: chargeId, refundedAt: null },
      data: { refundedAt: new Date() },
    })
    if (res.count === 0) return
    const charge = await tx.tokenCharge.findUnique({ where: { id: chargeId } })
    if (!charge) return
    const wallet = await tx.wallet.findUnique({ where: { userId: charge.userId } })
    if (!wallet) return
    await tx.wallet.update({
      where: { id: wallet.id },
      data: { balance: { increment: charge.tokens } },
    })
    await tx.transaction.create({
      data: {
        walletId: wallet.id,
        type: 'CREDIT',
        amount: charge.tokens,
        currency: 'TOKEN',
        description: `Возврат: ${reason}`,
        relatedVersionId: charge.versionId,
      },
    })
  })
}

/** Загруженный ли документ: у первой версии aiSettings.base === 'upload' */
export async function isUploadedDocument(documentId: string): Promise<boolean> {
  const first = await prisma.version.findFirst({
    where: { documentId },
    orderBy: { number: 'asc' },
    select: { aiSettings: true },
  })
  const s = first?.aiSettings as { base?: string } | null
  return s?.base === 'upload'
}

/** Квота ИИ-правок документа */
export async function getEditQuota(documentId: string) {
  const [doc, packages, totalPackageCharges, isUploaded] = await Promise.all([
    prisma.document.findUnique({ where: { id: documentId }, select: { aiEditsUsed: true } }),
    prisma.tokenCharge.count({
      where: { documentId, refundedAt: null, kind: { in: PACKAGE_KINDS } },
    }),
    // Все списания-пакеты за историю (включая возвращённые) — отличаем
    // до-токеновый документ от документа с возвращённым списанием.
    prisma.tokenCharge.count({
      where: { documentId, kind: { in: PACKAGE_KINDS } },
    }),
    isUploadedDocument(documentId),
  ])
  const limit = calcEditLimit(packages, isUploaded, totalPackageCharges > 0)
  const used = doc?.aiEditsUsed ?? 0
  return { limit, used, remaining: Math.max(0, limit - used), packages, isUploaded }
}

export function insufficientTokensResponse(err: InsufficientTokensError) {
  return NextResponse.json(
    {
      error: `Не хватает токенов: нужно ${formatTokens(err.required)}, на балансе ${formatTokens(err.balance)}.`,
      code: 'INSUFFICIENT_TOKENS',
      balance: err.balance,
      required: err.required,
    },
    { status: 402 },
  )
}
