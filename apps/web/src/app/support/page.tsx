'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input, Textarea, Select, Field } from '@/components/ui/input'

type Category = 'question' | 'problem' | 'billing' | 'idea' | 'other'

const CATEGORY_OPTIONS: { value: Category; label: string }[] = [
  { value: 'question', label: 'Вопрос по работе' },
  { value: 'problem', label: 'Проблема / ошибка' },
  { value: 'billing', label: 'Оплата и токены' },
  { value: 'idea', label: 'Предложение' },
  { value: 'other', label: 'Другое' },
]

export default function SupportPage() {
  const [supportEmail, setSupportEmail] = useState<string | null>(null)
  const [mailConfigured, setMailConfigured] = useState(true)

  const [authedEmail, setAuthedEmail] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [category, setCategory] = useState<Category>('question')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  // Конфиг формы + контекст пользователя
  useEffect(() => {
    fetch('/api/support')
      .then((r) => r.json())
      .then((d: { supportEmail: string | null; mailConfigured: boolean }) => {
        setSupportEmail(d.supportEmail)
        setMailConfigured(d.mailConfigured)
      })
      .catch(() => {})

    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { user?: { email?: string } } | null) => {
        if (d?.user?.email) {
          setAuthedEmail(d.user.email)
          setEmail(d.user.email)
        }
      })
      .catch(() => {})
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await fetch('/api/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category,
          subject,
          message,
          ...(authedEmail ? {} : { email }),
        }),
      })
      const data = (await res.json()) as { error?: string; mailConfigured?: boolean }
      if (!res.ok) {
        if (data.mailConfigured === false) setMailConfigured(false)
        setError(data.error ?? 'Не удалось отправить обращение')
        return
      }
      setSent(true)
    } catch {
      setError('Ошибка подключения. Проверьте интернет.')
    } finally {
      setLoading(false)
    }
  }

  const mailtoHref = supportEmail
    ? `mailto:${supportEmail}?subject=${encodeURIComponent('Обращение в поддержку Догодка')}`
    : undefined

  return (
    <div className="min-h-screen bg-[var(--bg)] flex flex-col">
      {/* Шапка */}
      <header className="border-b border-[var(--line)] bg-[var(--surface)]">
        <div className="max-w-[720px] mx-auto px-[24px] h-[60px] flex items-center justify-between">
          <Link
            href="/"
            className="font-[var(--font-display)] text-[17px] font-semibold text-[var(--ink)] tracking-[-0.02em] no-underline"
          >
            Догодок
          </Link>
          <Link
            href="/"
            className="text-[13px] text-[var(--ink-3)] hover:text-[var(--ink)] no-underline transition-colors duration-[120ms]"
          >
            На главную
          </Link>
        </div>
      </header>

      <main className="flex-1 w-full max-w-[560px] mx-auto px-[24px] py-[48px]">
        <h1 className="font-[var(--font-display)] text-[28px] font-normal text-[var(--ink)] mb-[8px]">
          Поддержка
        </h1>
        <p className="text-[14px] text-[var(--ink-3)] leading-[1.6] mb-[28px]">
          Опишите вопрос или проблему — мы ответим на вашу почту. Обычно отвечаем в течение
          рабочего дня.
        </p>

        {sent ? (
          <div className="rounded-[var(--radius-lg)] border border-[var(--line-2)] bg-[var(--surface)] p-[24px]">
            <div className="text-[16px] font-medium text-[var(--ink)] mb-[6px]">
              Обращение отправлено
            </div>
            <p className="text-[13px] text-[var(--ink-3)] leading-[1.6]">
              Мы получили ваше сообщение и ответим на{' '}
              <span className="font-medium text-[var(--ink)]">{authedEmail ?? email}</span>.
              Проверьте почту, в том числе папку «Спам».
            </p>
            <div className="mt-[18px] flex gap-[10px]">
              <Link href="/" className="no-underline">
                <Button variant="secondary">На главную</Button>
              </Link>
              <Button
                variant="ghost"
                onClick={() => {
                  setSent(false)
                  setSubject('')
                  setMessage('')
                }}
              >
                Новое обращение
              </Button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-[16px] rounded-[var(--radius-lg)] border border-[var(--line-2)] bg-[var(--surface)] p-[24px]"
          >
            {/* E-mail: для гостя — вводит сам, для залогиненного — из аккаунта */}
            <Field label="Ваш e-mail для ответа" htmlFor="support-email">
              {authedEmail ? (
                <div className="flex items-center h-[38px] px-[12px] rounded-[var(--radius-md)] bg-[var(--surface-inset)] border border-[var(--line)] text-[14px] text-[var(--ink-2)]">
                  {authedEmail}
                </div>
              ) : (
                <Input
                  id="support-email"
                  type="email"
                  placeholder="name@company.ru"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              )}
            </Field>

            <Field label="Тема обращения" htmlFor="support-category">
              <Select
                id="support-category"
                value={category}
                onChange={(e) => setCategory(e.target.value as Category)}
              >
                {CATEGORY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Коротко о проблеме" htmlFor="support-subject">
              <Input
                id="support-subject"
                type="text"
                placeholder="Например: не скачивается договор в Word"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={140}
                required
              />
            </Field>

            <Field label="Подробное описание" htmlFor="support-message">
              <Textarea
                id="support-message"
                placeholder="Что вы делали, что ожидали и что произошло. Чем подробнее — тем быстрее поможем."
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={6}
                maxLength={5000}
                charCount={message.length}
                maxChars={5000}
                required
              />
            </Field>

            {error && (
              <div className="text-[13px] text-[var(--danger)] bg-[var(--danger-soft)] px-[12px] py-[8px] rounded-[var(--radius-md)]">
                {error}
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              loading={loading}
              disabled={!mailConfigured}
              className="w-full justify-center mt-[4px]"
            >
              Отправить обращение
            </Button>

            {!mailConfigured && (
              <p className="text-[12px] text-[var(--ink-4)] leading-[1.5] text-center">
                Отправка через сайт временно недоступна.
                {supportEmail ? ' Напишите нам напрямую на почту ниже.' : ''}
              </p>
            )}
          </form>
        )}

        {/* Прямой контакт — всегда виден как запасной канал */}
        {supportEmail && (
          <div className="mt-[24px] flex items-center gap-[8px] text-[13px] text-[var(--ink-3)]">
            <span>Или напишите напрямую:</span>
            <a
              href={mailtoHref}
              className="font-[var(--font-mono)] text-[var(--accent)] hover:text-[var(--accent-hover)] underline underline-offset-2"
            >
              {supportEmail}
            </a>
          </div>
        )}
      </main>

      {/* Подвал */}
      <footer className="border-t border-[var(--line)] mt-[24px]">
        <div className="max-w-[720px] mx-auto px-[24px] py-[24px] flex flex-wrap gap-x-[22px] gap-y-[10px]">
          <Link
            href="/legal"
            className="text-[12.5px] text-[var(--ink-4)] hover:text-[var(--ink-2)] no-underline transition-colors duration-[120ms]"
          >
            Правовые документы
          </Link>
          <Link
            href="/login"
            className="text-[12.5px] text-[var(--ink-4)] hover:text-[var(--ink-2)] no-underline transition-colors duration-[120ms]"
          >
            Вход в сервис
          </Link>
        </div>
      </footer>
    </div>
  )
}
