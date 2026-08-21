'use client'

/**
 * Остаток токенов на рабочем экране.
 *
 * Клик по кнопке НЕ уводит со страницы: пользователь в середине работы над
 * документом, и уход на баланс сбивает всё. Открывается небольшое окно с
 * остатком и наглядной шкалой «на что хватит». Пополнение — отдельная ссылка
 * внутри окна, то есть осознанное действие.
 */

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatTokens } from '@/lib/token-pricing'

/** Сколько документов помещается в шкалу. Один значок = один договор. */
const SCALE_SLOTS = 20

interface TokenBalancePopoverProps {
  balance: number
  prices?: { generate?: number; editPackage?: number; uploadEditStart?: number }
}

/** Шестиугольный жетон-токен с внутренней точкой — узнаётся как «токен», не карта. */
function IconToken({ size = 12 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0"
    >
      <path d="M12 2.5l8.2 4.75v9.5L12 21.5l-8.2-4.75v-9.5L12 2.5z" />
      <circle cx="12" cy="12" r="3.2" />
    </svg>
  )
}

function DocIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="9" height="12" viewBox="0 0 24 30" aria-hidden className="shrink-0">
      <path
        d="M4 1h11l6 6v22a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z"
        fill={filled ? 'var(--accent)' : 'transparent'}
        stroke={filled ? 'var(--accent)' : 'var(--line-2)'}
        strokeWidth="1.6"
      />
      <path d="M15 1v6h6" fill="none" stroke={filled ? 'white' : 'var(--line-2)'} strokeWidth="1.6" />
    </svg>
  )
}

export function TokenBalancePopover({ balance, prices }: TokenBalancePopoverProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const generatePrice = prices?.generate ?? 100
  const packagePrice = prices?.editPackage ?? 100

  // «На что хватит» — понятнее, чем проценты: сколько ещё договоров можно создать
  const docsLeft = Math.floor(balance / Math.max(1, generatePrice))
  const packsLeft = Math.floor(balance / Math.max(1, packagePrice))
  const filledSlots = Math.min(SCALE_SLOTS, docsLeft)

  return (
    <div ref={boxRef} className="relative shrink-0 hidden md:block">
      <button
        onClick={() => setOpen((v) => !v)}
        className="h-[30px] px-[10px] rounded-[var(--radius-md)] text-[11px] font-medium text-[var(--ink-2)] border border-[var(--line-2)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer flex items-center gap-[5px]"
        title="Остаток токенов"
        aria-expanded={open}
      >
        <IconToken />
        <span style={{ fontFamily: 'var(--font-mono)' }}>{balance.toLocaleString('ru')}</span>
      </button>

      {open && (
        <div
          className="absolute right-0 top-[38px] z-50 w-[300px] rounded-[var(--radius-lg)] p-[16px]"
          style={{ background: 'white', border: '1px solid var(--line-2)', boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}
        >
          <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.08em] mb-[6px]">
            Остаток
          </p>
          <p className="text-[20px] font-medium text-[var(--ink)] mb-[12px]" style={{ fontFamily: 'var(--font-mono)' }}>
            {formatTokens(balance)}
          </p>

          {/* Шкала: один значок — один договор. Показывает «на что хватит»,
              без процентов — так понятнее, чем доля израсходованного. */}
          <div className="flex gap-[2px] flex-nowrap mb-[8px]">
            {Array.from({ length: SCALE_SLOTS }, (_, i) => (
              <DocIcon key={i} filled={i < filledSlots} />
            ))}
          </div>

          <p className="text-[11.5px] text-[var(--ink-3)] leading-[1.5]">
            {docsLeft > 0
              ? <>Хватит примерно на <strong>{docsLeft}</strong>{docsLeft > SCALE_SLOTS ? '+' : ''} {docsLeft === 1 ? 'договор' : docsLeft < 5 ? 'договора' : 'договоров'} с нуля или <strong>{packsLeft}</strong> {packsLeft === 1 ? 'пакет' : packsLeft < 5 ? 'пакета' : 'пакетов'} правок.</>
              : <>Токенов не хватает на новый договор — пополните баланс.</>}
          </p>
          <p className="text-[11px] text-[var(--ink-4)] leading-[1.5] mt-[6px]">
            Ручное редактирование, скачивание и печать — бесплатно.
          </p>

          <button
            onClick={() => { setOpen(false); router.push('/balance') }}
            className="mt-[12px] w-full h-[30px] rounded-[var(--radius-md)] text-[12px] font-medium bg-[var(--surface-inset)] text-[var(--ink-2)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
          >
            Пополнить баланс →
          </button>
        </div>
      )}
    </div>
  )
}
