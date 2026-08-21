import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { isMailConfigured, getSupportEmail, sendMail } from '@/lib/mailer'
import { logger } from '@/lib/logger'
import { getRequestId } from '@/lib/request-context'

/**
 * Обращение в техподдержку.
 *
 * POST /api/support — принимает форму (категория, тема, сообщение, e-mail для гостя),
 * формирует структурированное письмо и отправляет на адрес поддержки.
 * В заголовок Reply-To кладётся e-mail пользователя — поддержка отвечает одним «Ответить».
 *
 * Работает и для гостей (нужно указать e-mail), и для залогиненных
 * (e-mail и контекст аккаунта берутся из БД, полю в форме нельзя доверять).
 *
 * Тело обращения нигде не логируется — это свободный текст пользователя.
 */

const CATEGORIES = {
  question: 'Вопрос по работе',
  problem: 'Проблема / ошибка',
  billing: 'Оплата и токены',
  idea: 'Предложение',
  other: 'Другое',
} as const

const SupportSchema = z.object({
  category: z.enum(Object.keys(CATEGORIES) as [keyof typeof CATEGORIES], {
    message: 'Выберите тему обращения',
  }),
  subject: z.string().trim().min(3, 'Слишком короткая тема').max(140, 'Тема слишком длинная'),
  message: z
    .string()
    .trim()
    .min(10, 'Опишите проблему подробнее (минимум 10 символов)')
    .max(5000, 'Сообщение слишком длинное'),
  email: z.string().trim().email('Укажите корректный e-mail').max(200).optional(),
})

/**
 * GET /api/support — конфигурация формы для клиента: публичный адрес поддержки
 * (для запасного mailto) и доступна ли отправка через сайт.
 */
export function GET() {
  return NextResponse.json({
    supportEmail: getSupportEmail() ?? null,
    mailConfigured: isMailConfigured(),
  })
}

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)

  // Защита от спама: не более 5 обращений за 10 минут с одного IP.
  const rl = await rateLimit(`support:${ip}`, 5, 10 * 60 * 1000)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: `Слишком много обращений. Попробуйте через ${rl.retryAfterSec} с.` },
      { status: 429 },
    )
  }

  const supportEmail = getSupportEmail()

  if (!isMailConfigured() || !supportEmail) {
    logger.error({ event: 'support.not_configured', request_id: getRequestId(req) })
    return NextResponse.json(
      {
        error: 'Отправка временно недоступна. Напишите нам напрямую на почту поддержки.',
        mailConfigured: false,
      },
      { status: 503 },
    )
  }

  let data: z.infer<typeof SupportSchema>
  try {
    data = SupportSchema.parse(await req.json())
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json({ error: err.issues[0]?.message ?? 'Ошибка валидации' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Некорректный запрос' }, { status: 400 })
  }

  // Контекст аккаунта: для залогиненного берём из БД (форме не доверяем),
  // для гостя — e-mail из формы.
  const userId = await getUserId(req)
  let account:
    | { userId: string; email: string; fullName: string | null; balance: string; createdAt: Date }
    | null = null

  if (userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, fullName: true, createdAt: true, wallet: { select: { balance: true } } },
    })
    if (user) {
      account = {
        userId,
        email: user.email,
        fullName: user.fullName,
        balance: (user.wallet?.balance ?? 0).toString(),
        createdAt: user.createdAt,
      }
    }
  }

  const fromEmail = account?.email ?? data.email
  if (!fromEmail) {
    return NextResponse.json({ error: 'Укажите e-mail для ответа' }, { status: 400 })
  }

  const categoryLabel = CATEGORIES[data.category]
  const userAgent = req.headers.get('user-agent') ?? '—'
  const referer = req.headers.get('referer') ?? '—'
  const now = new Date()
  const when = now.toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' })

  const subject = `[Догодок] ${categoryLabel}: ${data.subject}`

  const metaLines = [
    `Категория: ${categoryLabel}`,
    `E-mail для ответа: ${fromEmail}`,
    account
      ? `Аккаунт: ${account.fullName ?? '—'} · id ${account.userId} · баланс ${account.balance} токенов · регистрация ${account.createdAt.toLocaleDateString('ru-RU')}`
      : 'Аккаунт: не авторизован (гость)',
    `Дата (МСК): ${when}`,
    `Страница: ${referer}`,
    `IP: ${ip}`,
    `User-Agent: ${userAgent}`,
  ]

  const text = [
    `Тема: ${data.subject}`,
    '',
    'Сообщение:',
    data.message,
    '',
    '———',
    ...metaLines,
  ].join('\n')

  const html = renderHtml({
    subject: data.subject,
    message: data.message,
    metaLines,
  })

  try {
    await sendMail({ to: supportEmail, subject, text, html, replyTo: fromEmail })
  } catch (err) {
    logger.error({ event: 'support.send_failed', error: err, request_id: getRequestId(req) })
    return NextResponse.json(
      { error: 'Не удалось отправить обращение. Напишите нам напрямую на почту поддержки.' },
      { status: 502 },
    )
  }

  logger.info({ event: 'support.sent', authenticated: Boolean(account), category: data.category })
  return NextResponse.json({ ok: true })
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderHtml({
  subject,
  message,
  metaLines,
}: {
  subject: string
  message: string
  metaLines: string[]
}): string {
  return `<!doctype html>
<html lang="ru"><body style="margin:0;background:#faf8f3;padding:24px;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#18181b">
  <div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e7e2d8;border-radius:12px;overflow:hidden">
    <div style="padding:20px 24px;border-bottom:1px solid #efeae0">
      <div style="font-size:13px;color:#8a8577">Догодок · Техподдержка</div>
      <div style="font-size:18px;font-weight:600;margin-top:4px">${esc(subject)}</div>
    </div>
    <div style="padding:20px 24px;font-size:14px;line-height:1.6;white-space:pre-wrap">${esc(message)}</div>
    <div style="padding:16px 24px;border-top:1px solid #efeae0;background:#faf8f3;font-size:12px;line-height:1.7;color:#6b6558">
      ${metaLines.map((l) => esc(l)).join('<br>')}
    </div>
  </div>
</body></html>`
}
