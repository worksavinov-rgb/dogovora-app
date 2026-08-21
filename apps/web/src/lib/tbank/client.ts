import { signToken } from './signature'

export interface InitParams {
  orderId: string
  amountKopecks: number
  description: string
  receipt: Record<string, unknown>
}

export interface InitResult {
  paymentId: string
  paymentUrl: string
}

function apiBase(): string {
  return process.env.TBANK_API_URL || 'https://securepay.tinkoff.ru/v2/'
}

function publicBase(): string {
  return process.env.PUBLIC_BASE_URL || ''
}

function assertAbsolutePublicBase(base: string): void {
  if (!/^https?:\/\/.+/i.test(base)) {
    // Пустой/относительный PUBLIC_BASE_URL даёт относительный NotificationURL — если банк
    // такой всё же примет, пользователь оплатит, а нотификация никогда не придёт (тихая
    // невосстановимая потеря). Лучше упасть на Init явной 502-ошибкой создания платежа.
    throw new TBankInitError(
      `PUBLIC_BASE_URL должен быть абсолютным http(s) URL, получено: "${base}"`,
      'invalid_public_base_url',
    )
  }
}

/**
 * Ошибка инициации платежа. `code` — стабильный машиночитаемый маркер без банковского
 * свободного текста (Message/Details могут содержать ПДн из чека — email и т.п.),
 * его безопасно логировать; полный `message` — для внутренней диагностики у вызывающего.
 */
export class TBankInitError extends Error {
  code: string
  constructor(message: string, code: string) {
    super(message)
    this.name = 'TBankInitError'
    this.code = code
  }
}

/**
 * Инициирует одностадийный платёж. Подпись считается по КОРНЕВЫМ полям
 * (Receipt в подпись не входит — так требует Т-Банк). Возвращает ссылку на
 * платёжную страницу для редиректа.
 */
export async function initPayment(params: InitParams, fetchImpl: typeof fetch = fetch): Promise<InitResult> {
  const base = publicBase()
  assertAbsolutePublicBase(base)
  const root: Record<string, unknown> = {
    TerminalKey: process.env.TBANK_TERMINAL_KEY || '',
    Amount: params.amountKopecks,
    OrderId: params.orderId,
    Description: params.description.slice(0, 140),
    PayType: 'O',
    NotificationURL: `${base}/api/payments/webhook`,
    SuccessURL: `${base}/balance?payment=success`,
    FailURL: `${base}/balance?payment=fail`,
  }
  const Token = signToken(root, process.env.TBANK_PASSWORD || '')
  const body = { ...root, Token, Receipt: params.receipt }

  const res = await fetchImpl(`${apiBase()}Init`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = (await res.json()) as {
    Success?: boolean
    PaymentId?: string | number
    PaymentURL?: string
    ErrorCode?: string
    Message?: string
    Details?: string
  }
  if (!data.Success || !data.PaymentURL) {
    throw new TBankInitError(
      `Init failed: ${data.ErrorCode ?? '?'} ${data.Message ?? ''} ${data.Details ?? ''}`.trim(),
      data.ErrorCode ?? 'unknown',
    )
  }
  return { paymentId: String(data.PaymentId), paymentUrl: data.PaymentURL }
}
