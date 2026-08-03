'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { useAuthStore } from '@/store/auth'

/**
 * Приём согласий для аккаунтов, созданных до их введения,
 * и при выходе новой редакции правовых документов.
 *
 * Закрыть окно нельзя — по 152-ФЗ обработка продолжается только при наличии
 * согласия. Доступен выход из аккаунта.
 */

function DocLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="text-[var(--accent)] hover:text-[var(--accent-hover)] underline underline-offset-2"
    >
      {children}
    </Link>
  )
}

export function ConsentGate() {
  const { setNeedsConsent, logout } = useAuthStore()

  const [offer, setOffer] = useState(false)
  const [pdn, setPdn] = useState(false)
  const [crossBorder, setCrossBorder] = useState(false)
  const [marketing, setMarketing] = useState(false)
  const [showError, setShowError] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const ready = offer && pdn && crossBorder

  async function handleAccept() {
    if (!ready) {
      setShowError(true)
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/consents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          consentOffer: true,
          consentPdn: true,
          consentCrossBorder: true,
          consentMarketing: marketing,
        }),
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        setError(data.error ?? 'Не удалось сохранить. Попробуйте ещё раз.')
        return
      }
      setNeedsConsent(false)
    } catch {
      setError('Ошибка подключения. Проверьте интернет.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-[20px]">
      <div className="absolute inset-0 bg-black/35 backdrop-blur-[2px]" />

      <div
        className="relative z-10 w-full max-w-[480px] rounded-[var(--radius-xl)] p-[28px_30px] max-h-[90vh] overflow-y-auto"
        style={{
          background: 'var(--bg)',
          border: '1px solid var(--line)',
          boxShadow: '0 16px 40px rgba(0,0,0,0.16)',
        }}
      >
        <h2 className="text-[19px] font-[var(--font-display)] font-normal text-[var(--ink)] mb-[8px]">
          Мы обновили правовые документы
        </h2>
        <p className="text-[13px] text-[var(--ink-3)] leading-[1.6] mb-[20px]">
          Чтобы продолжить работу, подтвердите согласие с условиями сервиса. Это займёт полминуты —
          мы описали, какие данные обрабатываются и как они используются при работе ИИ.
        </p>

        <div className="flex flex-col gap-[12px]">
          <Checkbox
            compact
            checked={offer}
            error={showError && !offer}
            onChange={(e) => setOffer(e.target.checked)}
          >
            Принимаю <DocLink href="/legal/offer">публичную оферту</DocLink> и{' '}
            <DocLink href="/legal/terms">пользовательское соглашение</DocLink>
          </Checkbox>

          <Checkbox
            compact
            checked={pdn}
            error={showError && !pdn}
            onChange={(e) => setPdn(e.target.checked)}
          >
            Даю <DocLink href="/legal/pdn-consent">согласие на обработку персональных данных</DocLink>{' '}
            и ознакомлен с <DocLink href="/legal/privacy">политикой обработки</DocLink>
          </Checkbox>

          <Checkbox
            compact
            checked={crossBorder}
            error={showError && !crossBorder}
            onChange={(e) => setCrossBorder(e.target.checked)}
          >
            Даю{' '}
            <DocLink href="/legal/cross-border">
              согласие на трансграничную передачу данных
            </DocLink>{' '}
            — часть ИИ-моделей работает за пределами России
          </Checkbox>

          <Checkbox compact checked={marketing} onChange={(e) => setMarketing(e.target.checked)}>
            Хочу получать письма о новых возможностях сервиса{' '}
            <span className="text-[var(--ink-5)]">— по желанию</span>
          </Checkbox>
        </div>

        {(showError && !ready) || error ? (
          <div className="mt-[16px] text-[12.5px] text-[var(--danger)] bg-[var(--danger-soft)] px-[12px] py-[8px] rounded-[var(--radius-md)]">
            {error || 'Отметьте три обязательных пункта, чтобы продолжить'}
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-[12px] mt-[22px]">
          <button
            type="button"
            onClick={() => void logout()}
            className="text-[12.5px] text-[var(--ink-4)] hover:text-[var(--ink-2)] bg-transparent border-0 cursor-pointer transition-colors duration-[120ms]"
          >
            Выйти из аккаунта
          </button>
          <Button variant="primary" onClick={() => void handleAccept()} loading={loading}>
            Принять и продолжить
          </Button>
        </div>
      </div>
    </div>
  )
}
