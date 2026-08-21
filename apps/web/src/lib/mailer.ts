import nodemailer, { type Transporter } from 'nodemailer'
import { logger } from '@/lib/logger'

/**
 * Отправка почты через SMTP (nodemailer).
 *
 * Единственное назначение на текущем этапе — письма техподдержки из формы
 * обращения (`/support`). Настройки берутся из ENV; если SMTP не сконфигурирован,
 * отправка недоступна — форма показывает прямой e-mail поддержки как запасной канал.
 *
 * ENV:
 *   SMTP_HOST      — адрес SMTP-сервера (напр. smtp.yandex.ru)
 *   SMTP_PORT      — порт (465 для SSL, 587 для STARTTLS)
 *   SMTP_SECURE    — 'true' для 465/SSL; иначе STARTTLS. По умолчанию — port === 465
 *   SMTP_USER      — логин (полный адрес ящика)
 *   SMTP_PASSWORD  — пароль приложения (не основной пароль от ящика!)
 *   SMTP_FROM      — отправитель, напр. "Догодок <support@dogodoc.ru>". По умолчанию SMTP_USER
 *   SUPPORT_EMAIL  — адрес получателя обращений. По умолчанию SMTP_USER
 */

function env(name: string): string | undefined {
  const v = process.env[name]
  return v && v.trim() !== '' ? v.trim() : undefined
}

/** Настроена ли отправка почты (есть хост и учётные данные). */
export function isMailConfigured(): boolean {
  return Boolean(env('SMTP_HOST') && env('SMTP_USER') && env('SMTP_PASSWORD'))
}

/** Адрес техподдержки для отображения/получения писем. Может быть пустым. */
export function getSupportEmail(): string | undefined {
  return env('SUPPORT_EMAIL') ?? env('SMTP_USER')
}

let cachedTransport: Transporter | null = null

function getTransport(): Transporter | null {
  if (!isMailConfigured()) return null
  if (cachedTransport) return cachedTransport

  const host = env('SMTP_HOST')!
  const port = Number(env('SMTP_PORT') ?? '465')
  const secure = env('SMTP_SECURE') ? env('SMTP_SECURE') === 'true' : port === 465

  cachedTransport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user: env('SMTP_USER')!,
      pass: env('SMTP_PASSWORD')!,
    },
  })

  return cachedTransport
}

export interface SendMailInput {
  to: string
  subject: string
  text: string
  html?: string
  /** Адрес для ответа — сюда поддержка «ответит» одним кликом. */
  replyTo?: string
}

/**
 * Отправляет письмо. Бросает исключение при ошибке транспорта.
 * В логи попадают только тема (усечённая) и коды — без тела письма.
 */
export async function sendMail(input: SendMailInput): Promise<void> {
  const transport = getTransport()
  if (!transport) {
    throw new Error('SMTP не настроен')
  }

  const from = env('SMTP_FROM') ?? env('SMTP_USER')!

  await transport.sendMail({
    from,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
    replyTo: input.replyTo,
  })

  // В логи — только метаданные, без адресов и тела письма.
  logger.info({
    event: 'mail.sent',
    subject_len: input.subject.length,
  })
}
