import type { ConsentKind, Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { LEGAL_VERSION } from '@/lib/legal'

/**
 * Согласия пользователя (152-ФЗ).
 *
 * Таблица user_consents — append-only: отзыв согласия записывается новой строкой
 * с granted = false. Актуальным считается последнее по времени решение.
 *
 * В логи попадают только вид согласия и флаг — никаких текстов и содержимого.
 */

/** Согласия, без которых нельзя создать аккаунт. */
export const REQUIRED_CONSENTS: ConsentKind[] = ['OFFER', 'PDN', 'CROSS_BORDER']

/** Все виды согласий, которые собирает сервис. */
export const ALL_CONSENTS: ConsentKind[] = [...REQUIRED_CONSENTS, 'MARKETING']

export interface ConsentContext {
  ip?: string | null
  userAgent?: string | null
  source?: string
}

/** Строки для tx.userConsent.createMany — используется внутри транзакции регистрации. */
export function buildConsentRows(
  userId: string,
  kinds: ConsentKind[],
  ctx: ConsentContext = {},
): Prisma.UserConsentCreateManyInput[] {
  return kinds.map((kind) => ({
    userId,
    kind,
    granted: true,
    docVersion: LEGAL_VERSION,
    source: ctx.source ?? 'registration',
    ip: ctx.ip ?? null,
    userAgent: ctx.userAgent?.slice(0, 500) ?? null,
  }))
}

/** Записывает решение пользователя по одному согласию (выдал или отозвал). */
export async function recordConsent(
  userId: string,
  kind: ConsentKind,
  granted: boolean,
  ctx: ConsentContext = {},
): Promise<void> {
  await prisma.userConsent.create({
    data: {
      userId,
      kind,
      granted,
      docVersion: LEGAL_VERSION,
      source: ctx.source ?? 'settings',
      ip: ctx.ip ?? null,
      userAgent: ctx.userAgent?.slice(0, 500) ?? null,
    },
  })
}

export interface ConsentState {
  /** Последнее решение по каждому виду согласия. undefined — вопрос не задавался. */
  granted: Partial<Record<ConsentKind, boolean>>
  /** Редакция документов, которую пользователь принял последней. */
  acceptedVersion: string | null
  /** Нужно ли показать пользователю форму принятия (не принято или новая редакция). */
  needsAcceptance: boolean
}

/** Текущее состояние согласий пользователя. */
export async function getConsentState(userId: string): Promise<ConsentState> {
  const rows = await prisma.userConsent.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { kind: true, granted: true, docVersion: true, createdAt: true },
  })

  const granted: Partial<Record<ConsentKind, boolean>> = {}
  const versionByKind: Partial<Record<ConsentKind, string>> = {}

  // rows отсортированы от новых к старым — первое вхождение и есть актуальное
  for (const row of rows) {
    if (granted[row.kind] === undefined) {
      granted[row.kind] = row.granted
      versionByKind[row.kind] = row.docVersion
    }
  }

  const requiredOk = REQUIRED_CONSENTS.every(
    (kind) => granted[kind] === true && versionByKind[kind] === LEGAL_VERSION,
  )

  const acceptedVersion = versionByKind['PDN'] ?? null

  return { granted, acceptedVersion, needsAcceptance: !requiredOk }
}

/**
 * Разрешено ли отправлять данные пользователя в зарубежные ИИ-сервисы.
 *
 * Отсутствие записи трактуется как «вопрос ещё не задавался» — такие пользователи
 * (зарегистрированные до внедрения согласий) не блокируются, им показывается
 * форма принятия. Блокируем только тех, кто согласие явно отозвал.
 */
export async function hasCrossBorderConsent(userId: string): Promise<boolean> {
  const last = await prisma.userConsent.findFirst({
    where: { userId, kind: 'CROSS_BORDER' },
    orderBy: { createdAt: 'desc' },
    select: { granted: true },
  })
  return last === null ? true : last.granted
}
