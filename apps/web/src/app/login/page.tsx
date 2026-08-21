'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input, Field } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { useAuthStore } from '@/store/auth'

type Mode = 'login' | 'register'

export default function LoginPage() {
  const router = useRouter()
  const { initialize } = useAuthStore()

  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [businessScope, setBusinessScope] = useState('')
  const [promoCode, setPromoCode] = useState('')
  const [remember, setRemember] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // Согласия (152-ФЗ). По умолчанию все сняты — предустановленная галочка
  // не считается согласием, выраженным свободно и своей волей.
  const [consentOffer, setConsentOffer] = useState(false)
  const [consentPdn, setConsentPdn] = useState(false)
  const [consentCrossBorder, setConsentCrossBorder] = useState(false)
  const [consentMarketing, setConsentMarketing] = useState(false)
  const [consentError, setConsentError] = useState(false)

  const consentsOk = consentOffer && consentPdn && consentCrossBorder

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (mode === 'register' && !consentsOk) {
      setConsentError(true)
      setError('Чтобы создать аккаунт, примите оферту и согласия на обработку данных')
      return
    }

    setConsentError(false)
    setLoading(true)

    try {
      const endpoint = mode === 'login' ? '/api/auth/login' : '/api/auth/register'
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          mode === 'register'
            ? {
                email,
                password,
                fullName,
                businessScope,
                promoCode,
                consentOffer,
                consentPdn,
                consentCrossBorder,
                consentMarketing,
              }
            : { email, password }
        ),
      })

      const data = await res.json() as { error?: string }

      if (!res.ok) {
        setError(data.error ?? 'Произошла ошибка')
        return
      }

      await initialize()
      router.push('/')
      router.refresh()
    } catch {
      setError('Ошибка подключения. Проверьте интернет.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center p-[16px] sm:p-6">
      {/* Карточка авторизации: на мобильных — одна колонка (шапка + форма) */}
      <div
        className="w-full max-w-[900px] grid grid-cols-1 md:grid-cols-2 md:min-h-[600px] rounded-[var(--radius-xl)] overflow-hidden border border-[var(--line-2)] shadow-[var(--shadow-2)]"
        style={{ background: 'var(--bg)' }}
      >

        {/* ─── Левая колонка — брендинг (на мобильных — компактная шапка) ── */}
        <div
          className="flex flex-col p-[20px_24px] md:p-[48px_56px] border-b md:border-b-0 md:border-r border-[var(--line)]"
          style={{
            background: 'linear-gradient(180deg, var(--bg-soft), var(--bg))',
          }}
        >
          {/* Логотип */}
          <div className="font-[var(--font-display)] text-[20px] font-semibold text-[var(--ink)] tracking-[-0.02em]">
            Догодок
          </div>

          {/* Короткий слоган — только на мобильных */}
          <p className="md:hidden text-[13px] text-[var(--ink-3)] mt-[4px]">
            Договоры, которые пишут и проверяют сами себя
          </p>

          {/* Центральный контент — скрыт на мобильных, чтобы форма была сразу видна */}
          <div className="hidden md:flex flex-1 flex-col justify-center max-w-[400px] mt-[48px]">
            <h1 style={{ fontSize: 40, lineHeight: 1.1, marginBottom: 20, fontWeight: 400 }}>
              Договоры, которые{' '}
              <em className="not-italic text-[var(--accent)]">пишут</em>{' '}
              и{' '}
              <em className="not-italic text-[var(--accent)]">проверяют</em>{' '}
              сами себя.
            </h1>
            <p style={{ fontSize: 15, color: 'var(--ink-3)', lineHeight: 1.6, marginBottom: 28 }}>
              Создавайте, проверяйте и сравнивайте договоры, приложения и допсоглашения
              с помощью Догодка. Версии, контрагенты и реквизиты — в одном тихом месте.
            </p>

            {/* Hallmarks */}
            <div className="flex items-center gap-[24px] text-[13px] text-[var(--ink-3)] flex-nowrap">
              <div className="flex items-center gap-[8px] whitespace-nowrap">
                <ShieldIcon />
                152-ФЗ
              </div>
              <div className="flex items-center gap-[8px] whitespace-nowrap">
                <LockIcon />
                Шифрование
              </div>
              <div className="flex items-center gap-[8px] whitespace-nowrap">
                <HistoryIcon />
                История версий
              </div>
            </div>
          </div>
        </div>

        {/* ─── Правая колонка — форма ────────────────────────────────── */}
        <div className="flex flex-col justify-center p-[24px_20px] md:p-[48px_56px] bg-[var(--surface)]">
          <div className="max-w-[360px] w-full mx-auto">

            {/* Переключатель Войти / Регистрация */}
            <div className="flex gap-[4px] mb-[32px] p-[4px] bg-[var(--surface-inset)] rounded-[var(--radius-md)] w-fit">
              {(['login', 'register'] as Mode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setMode(m); setError('') }}
                  className={[
                    'px-[14px] py-[6px] rounded-[6px] text-[13px] font-medium cursor-pointer border-0 transition-all duration-[120ms]',
                    mode === m
                      ? 'bg-[var(--surface)] text-[var(--ink)] shadow-[var(--shadow-1)]'
                      : 'text-[var(--ink-3)] bg-transparent hover:text-[var(--ink-2)]',
                  ].join(' ')}
                >
                  {m === 'login' ? 'Войти' : 'Создать аккаунт'}
                </button>
              ))}
            </div>

            {/* Заголовок */}
            <h2 className="text-[24px] font-[var(--font-display)] font-normal mb-[6px]">
              {mode === 'login' ? 'С возвращением' : 'Создать аккаунт'}
            </h2>
            <p className="text-[14px] text-[var(--ink-3)] mb-[28px]">
              {mode === 'login'
                ? 'Войдите, чтобы продолжить работу с договорами'
                : 'Заполните данные для создания аккаунта'}
            </p>

            {/* Форма */}
            <form onSubmit={handleSubmit} className="flex flex-col gap-[16px]">
              <Field label="Email" htmlFor="email">
                <Input
                  id="email"
                  type="email"
                  placeholder="name@company.ru"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </Field>

              {/* ФИО и сфера — только при регистрации */}
              {mode === 'register' && (
                <>
                  <Field label="ФИО" htmlFor="fullName">
                    <Input
                      id="fullName"
                      type="text"
                      placeholder="Иванов Иван Иванович"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      autoComplete="name"
                      required
                    />
                  </Field>
                  <Field label="Сфера деятельности" htmlFor="businessScope">
                    <Input
                      id="businessScope"
                      type="text"
                      placeholder="Строительство, IT, юридические услуги…"
                      value={businessScope}
                      onChange={(e) => setBusinessScope(e.target.value)}
                      autoComplete="off"
                      required
                    />
                  </Field>
                </>
              )}

              <Field label="Пароль" htmlFor="password">
                <Input
                  id="password"
                  type="password"
                  placeholder={mode === 'register' ? 'Минимум 8 символов' : '••••••••'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  required
                />
              </Field>

              {/* Промокод — только при регистрации */}
              {mode === 'register' && (
                <Field label="Промокод доступа" htmlFor="promoCode">
                  <Input
                    id="promoCode"
                    type="text"
                    placeholder="BETA-XXXX"
                    value={promoCode}
                    onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                    autoComplete="off"
                    required
                  />
                  <p className="text-[11px] text-[var(--ink-4)] mt-[4px]">
                    Регистрация доступна по приглашению. Промокод можно получить у администратора.
                  </p>
                </Field>
              )}

              {/* Согласия — только при регистрации */}
              {mode === 'register' && (
                <div className="flex flex-col gap-[11px] mt-[6px] pt-[16px] border-t border-[var(--line)]">
                  <Checkbox
                    compact
                    checked={consentOffer}
                    error={consentError && !consentOffer}
                    onChange={(e) => setConsentOffer(e.target.checked)}
                  >
                    Принимаю <DocLink href="/legal/offer">публичную оферту</DocLink> и{' '}
                    <DocLink href="/legal/terms">пользовательское соглашение</DocLink>
                  </Checkbox>

                  <Checkbox
                    compact
                    checked={consentPdn}
                    error={consentError && !consentPdn}
                    onChange={(e) => setConsentPdn(e.target.checked)}
                  >
                    Даю <DocLink href="/legal/pdn-consent">согласие на обработку персональных данных</DocLink>{' '}
                    и ознакомлен с <DocLink href="/legal/privacy">политикой обработки</DocLink>
                  </Checkbox>

                  <Checkbox
                    compact
                    checked={consentCrossBorder}
                    error={consentError && !consentCrossBorder}
                    onChange={(e) => setConsentCrossBorder(e.target.checked)}
                  >
                    Даю{' '}
                    <DocLink href="/legal/cross-border">
                      согласие на трансграничную передачу данных
                    </DocLink>{' '}
                    — часть ИИ-моделей работает за пределами России
                  </Checkbox>

                  <Checkbox
                    compact
                    checked={consentMarketing}
                    onChange={(e) => setConsentMarketing(e.target.checked)}
                  >
                    Хочу получать письма о новых возможностях сервиса{' '}
                    <span className="text-[var(--ink-5)]">— по желанию</span>
                  </Checkbox>

                  <p className="text-[11px] leading-[1.5] text-[var(--ink-5)] mt-[2px]">
                    Документы, реквизиты и контрагенты хранятся на серверах в России. Перед отправкой
                    в ИИ реквизиты и идентификаторы сторон маскируются.
                  </p>
                </div>
              )}

              {/* Запомнить / Забыли пароль */}
              {mode === 'login' && (
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-[8px] text-[13px] text-[var(--ink-2)] cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={remember}
                      onChange={(e) => setRemember(e.target.checked)}
                      className="accent-[var(--ink)] w-[14px] h-[14px]"
                    />
                    Запомнить меня
                  </label>
                  <button
                    type="button"
                    className="text-[13px] text-[var(--accent)] hover:text-[var(--accent-hover)] bg-transparent border-0 cursor-pointer transition-colors duration-[120ms]"
                  >
                    Забыли пароль?
                  </button>
                </div>
              )}

              {/* Ошибка */}
              {error && (
                <div className="text-[13px] text-[var(--danger)] bg-[var(--danger-soft)] px-[12px] py-[8px] rounded-[var(--radius-md)]">
                  {error}
                </div>
              )}

              {/* Кнопка */}
              <Button
                type="submit"
                variant="primary"
                size="lg"
                loading={loading}
                className="w-full justify-center mt-[4px]"
              >
                {mode === 'login' ? 'Войти' : 'Создать аккаунт'}
              </Button>
            </form>

            {/* Разделитель */}
            <div className="flex items-center gap-[12px] my-[24px] text-[12px] text-[var(--ink-4)]">
              <hr className="flex-1 border-0 border-t border-[var(--line)]" />
              или
              <hr className="flex-1 border-0 border-t border-[var(--line)]" />
            </div>

            {/* OAuth кнопки (MVP — не активны) */}
            <div className="flex gap-[8px]">
              <Button variant="secondary" className="flex-1 justify-center" disabled>
                Через Госуслуги
              </Button>
              <Button variant="secondary" className="flex-1 justify-center" disabled>
                Через Яндекс ID
              </Button>
            </div>
            <p className="text-[11px] text-[var(--ink-5)] text-center mt-[8px]">
              Скоро
            </p>

            {/* Помощь */}
            <p className="text-[12px] text-[var(--ink-4)] text-center mt-[24px] pt-[20px] border-t border-[var(--line)]">
              Не получается войти или есть вопрос?{' '}
              <Link
                href="/support"
                className="text-[var(--accent)] hover:text-[var(--accent-hover)] no-underline underline underline-offset-2 decoration-[var(--line-strong)]"
              >
                Написать в поддержку
              </Link>
            </p>

          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── Ссылка на правовой документ ──────────────────────────────────────── */

function DocLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="text-[var(--accent)] hover:text-[var(--accent-hover)] underline underline-offset-2 decoration-[var(--line-strong)]"
    >
      {children}
    </Link>
  )
}

/* ─── Мини-иконки ──────────────────────────────────────────────────────── */

function ShieldIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  )
}

function LockIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
  )
}

function HistoryIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="1 4 1 10 7 10"/>
      <path d="M3.51 15a9 9 0 1 0 .49-4.95"/>
    </svg>
  )
}
