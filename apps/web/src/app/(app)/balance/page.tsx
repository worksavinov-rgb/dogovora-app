'use client'

import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/card'

// ─── Типы ─────────────────────────────────────────────────────────────────────

interface Transaction {
  id: string
  type: 'CREDIT' | 'DEBIT'
  amount: number
  description: string
  createdAt: string
  document: string | null
}

// ─── Константы ────────────────────────────────────────────────────────────────

const TOPUP_AMOUNTS = [500, 1000, 2000, 5000, 10000, 20000]

function formatMoney(n: number): string {
  return n.toLocaleString('ru', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

function relDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diff = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diff === 0) return `Сегодня, ${d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}`
  if (diff === 1) return 'Вчера'
  return d.toLocaleDateString('ru', { day: 'numeric', month: 'long' })
}

// ─── Модалка подтверждения пополнения ────────────────────────────────────────

function TopupModal({
  amount, balance, onConfirm, onClose, loading,
}: {
  amount: number; balance: number; onConfirm: () => void; onClose: () => void; loading: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-[var(--radius-xl)] shadow-xl w-[380px]" style={{ padding: '28px' }}>
        <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[16px]">
          Пополнение баланса
        </p>
        <div className="mb-[20px]">
          <p className="text-[13px] text-[var(--ink-3)] mb-[4px]">Сумма пополнения</p>
          <p className="text-[36px] font-medium text-[var(--ink)]" style={{ fontFamily: 'var(--font-serif)' }}>
            {formatMoney(amount)} ₽
          </p>
        </div>
        <div className="rounded-[var(--radius-md)] mb-[20px]" style={{ background: 'var(--surface-inset)', padding: '12px 14px' }}>
          {[
            { label: 'Текущий баланс', value: `${formatMoney(balance)} ₽`, green: false, bold: false },
            { label: 'Пополнение', value: `+ ${formatMoney(amount)} ₽`, green: true, bold: false },
            { label: 'После пополнения', value: `${formatMoney(balance + amount)} ₽`, green: false, bold: true },
          ].map((row) => (
            <div key={row.label} className="flex justify-between items-center py-[5px]">
              <p className="text-[12px] text-[var(--ink-4)]">{row.label}</p>
              <p className={['text-[13px]', row.bold ? 'font-medium text-[var(--ink)]' : '', row.green ? 'text-[oklch(0.45_0.1_145)]' : 'text-[var(--ink-2)]'].join(' ')}>
                {row.value}
              </p>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-[var(--ink-4)] mb-[16px]">
          В MVP пополнение происходит без реального платежа — деньги зачисляются мгновенно.
        </p>
        <div className="flex gap-[8px]">
          <button onClick={onClose}
            className="flex-1 h-[40px] rounded-[var(--radius-md)] text-[13px] font-medium bg-[var(--surface-inset)] text-[var(--ink-2)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer">
            Отмена
          </button>
          <button onClick={onConfirm} disabled={loading}
            className="flex-1 h-[40px] rounded-[var(--radius-md)] text-[13px] font-medium bg-[var(--ink)] text-[var(--bg)] hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50">
            {loading ? 'Пополняю…' : 'Пополнить'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Главная страница ─────────────────────────────────────────────────────────

export default function BalancePage() {
  const [balance, setBalance] = useState<number | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedAmount, setSelectedAmount] = useState<number | null>(null)
  const [topping, setTopping] = useState(false)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  async function loadData() {
    const [walletRes, txRes] = await Promise.all([
      fetch('/api/wallet'),
      fetch('/api/wallet/transactions?limit=5'),
    ])
    if (walletRes.ok) setBalance((await walletRes.json()).balance)
    if (txRes.ok) setTransactions((await txRes.json()).items ?? [])
    setLoading(false)
  }

  useEffect(() => { loadData() }, [])

  async function confirmTopup() {
    if (!selectedAmount) return
    setTopping(true)
    try {
      const res = await fetch('/api/wallet/topup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: selectedAmount }),
      })
      if (res.ok) {
        const data = await res.json()
        setBalance(data.balance)
        setSuccessMsg(`Баланс пополнен на ${formatMoney(selectedAmount)} ₽`)
        setTimeout(() => setSuccessMsg(null), 4000)
        await loadData()
      }
    } finally {
      setTopping(false)
      setSelectedAmount(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-[120px]">
        <div className="w-[24px] h-[24px] border-2 border-[var(--line)] border-t-[var(--ink)] rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <>
      {selectedAmount !== null && (
        <TopupModal amount={selectedAmount} balance={balance ?? 0}
          onConfirm={confirmTopup} onClose={() => setSelectedAmount(null)} loading={topping} />
      )}

      {successMsg && (
        <div className="fixed bottom-[24px] right-[24px] z-40 flex items-center gap-[10px] rounded-[var(--radius-lg)] shadow-lg"
          style={{ background: 'var(--ink)', color: 'var(--bg)', padding: '12px 16px' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          <span className="text-[13px] font-medium">{successMsg}</span>
        </div>
      )}

      <div className="max-w-[860px]">
        <div className="mb-[24px]">
          <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 400 }}>Баланс</h2>
        </div>

        <div className="grid grid-cols-[1fr_280px] gap-[20px]">
          {/* Левая колонка */}
          <div className="flex flex-col gap-[16px]">

            {/* Большой баланс */}
            <Card>
              <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[8px]">Доступно</p>
              <p className="leading-[1] mb-[4px]" style={{ fontFamily: 'var(--font-serif)', fontSize: 52, fontWeight: 400 }}>
                {formatMoney(balance ?? 0)}
                <span className="text-[var(--ink-3)] ml-[6px]" style={{ fontSize: 28 }}>₽</span>
              </p>
              <p className="text-[12px] text-[var(--ink-4)]">
                Хватит примерно на {Math.floor((balance ?? 0) / 540)} {pluralVersions(Math.floor((balance ?? 0) / 540))} договоров
              </p>
            </Card>

            {/* Быстрое пополнение */}
            <Card>
              <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[14px]">Пополнить баланс</p>
              <div className="grid grid-cols-3 gap-[8px]">
                {TOPUP_AMOUNTS.map((amt) => (
                  <button key={amt} onClick={() => setSelectedAmount(amt)}
                    className="h-[48px] rounded-[var(--radius-md)] text-[14px] font-medium bg-[var(--surface-inset)] text-[var(--ink-2)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)] transition-colors cursor-pointer"
                    style={{ fontFamily: 'var(--font-mono)' }}>
                    {formatMoney(amt)} ₽
                  </button>
                ))}
              </div>
            </Card>

            {/* Последние операции */}
            {transactions.length > 0 && (
              <Card pad={false}>
                <div className="px-[20px] py-[14px]" style={{ borderBottom: '1px solid var(--line)' }}>
                  <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em]">Последние операции</p>
                </div>
                {transactions.map((tx) => (
                  <div key={tx.id} className="flex items-center gap-[12px] px-[20px] py-[12px]"
                    style={{ borderBottom: '1px solid var(--line)' }}>
                    <div className="shrink-0 w-[32px] h-[32px] rounded-full flex items-center justify-center text-[13px] font-medium"
                      style={{
                        background: tx.type === 'CREDIT' ? 'oklch(0.95 0.02 145)' : 'oklch(0.96 0.025 20)',
                        color: tx.type === 'CREDIT' ? 'oklch(0.45 0.1 145)' : 'var(--danger)',
                      }}>
                      {tx.type === 'CREDIT' ? '+' : '−'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-[var(--ink)] truncate">{tx.description}</p>
                      <p className="text-[11px] text-[var(--ink-4)]">{relDate(tx.createdAt)}</p>
                    </div>
                    <p className="shrink-0 text-[14px] font-medium"
                      style={{ fontFamily: 'var(--font-mono)', color: tx.type === 'CREDIT' ? 'oklch(0.45 0.1 145)' : 'var(--ink)' }}>
                      {tx.type === 'CREDIT' ? '+' : '−'}{formatMoney(tx.amount)} ₽
                    </p>
                  </div>
                ))}
              </Card>
            )}

            {transactions.length === 0 && (
              <Card>
                <div className="py-[32px] text-center">
                  <p className="text-[14px] text-[var(--ink-3)]" style={{ fontFamily: 'var(--font-serif)' }}>
                    Операций пока нет
                  </p>
                  <p className="text-[12px] text-[var(--ink-4)] mt-[4px]">
                    Пополните баланс чтобы начать работу
                  </p>
                </div>
              </Card>
            )}
          </div>

          {/* Правая колонка */}
          <div className="flex flex-col gap-[12px]">
            <Card>
              <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[12px]">Стоимость</p>
              <div className="flex flex-col gap-[8px]">
                {[
                  { label: 'Версия договора', value: '540 ₽' },
                  { label: 'Повторное скачивание', value: 'Бесплатно' },
                  { label: 'Проверка рисков', value: 'Бесплатно' },
                  { label: 'ИИ-чат (правки)', value: 'Бесплатно' },
                ].map((row) => (
                  <div key={row.label} className="flex justify-between items-center text-[13px]">
                    <p className="text-[var(--ink-4)]">{row.label}</p>
                    <p className="font-medium text-[var(--ink)]" style={{ fontFamily: 'var(--font-mono)' }}>{row.value}</p>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[10px]">Как работает</p>
              <div className="flex flex-col gap-[6px] text-[12px] text-[var(--ink-3)] leading-[1.6]">
                <p>Платите только за финальную утверждённую версию.</p>
                <p>Все правки через ИИ-чат и проверки — бесплатны.</p>
                <p>Купленные версии можно скачивать повторно без доп. оплаты.</p>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </>
  )
}

function pluralVersions(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return 'версию'
  if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) return 'версии'
  return 'версий'
}
