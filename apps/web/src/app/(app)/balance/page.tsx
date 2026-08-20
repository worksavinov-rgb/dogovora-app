'use client'

import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/card'
import { formatTokens } from '@/lib/token-pricing'

// ─── Типы ─────────────────────────────────────────────────────────────────────

interface Transaction {
  id: string
  type: 'CREDIT' | 'DEBIT'
  amount: number
  currency?: 'RUB' | 'TOKEN'
  description: string
  createdAt: string
  document: string | null
}

interface Prices {
  generate: number
  uploadEditStart: number
  editPackage: number
  review: number
  analyzeUpload: number
  editsPerPackage: number
}

function formatMoney(n: number): string {
  return n.toLocaleString('ru', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

// Сумма операции: легаси-записи в рублях, новые — в токенах
function formatAmount(tx: Transaction): string {
  return tx.currency === 'RUB' ? `${formatMoney(tx.amount)} ₽` : formatMoney(tx.amount)
}

function relDate(iso: string): string {
  const d = new Date(iso)
  const now = new Date()
  const diff = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diff === 0) return `Сегодня, ${d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}`
  if (diff === 1) return 'Вчера'
  return d.toLocaleDateString('ru', { day: 'numeric', month: 'long' })
}

// ─── Главная страница ─────────────────────────────────────────────────────────

export default function BalancePage() {
  const [balance, setBalance] = useState<number | null>(null)
  const [prices, setPrices] = useState<Prices | null>(null)
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)

  async function loadData() {
    try {
      const [walletRes, txRes] = await Promise.all([
        fetch('/api/wallet'),
        fetch('/api/wallet/transactions?limit=5'),
      ])
      if (walletRes.ok) {
        const w = await walletRes.json()
        setBalance(w.balance)
        if (w.prices) setPrices(w.prices)
      }
      if (txRes.ok) setTransactions((await txRes.json()).items ?? [])
      if (!walletRes.ok && !txRes.ok) setLoadError(true)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-[120px]">
        <div className="w-[24px] h-[24px] border-2 border-[var(--line)] border-t-[var(--ink)] rounded-full animate-spin" />
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="max-w-[860px] py-[80px] text-center">
        <p className="text-[15px] text-[var(--ink-2)] mb-[6px]" style={{ fontFamily: 'var(--font-serif)' }}>
          Не удалось загрузить баланс
        </p>
        <p className="text-[13px] text-[var(--ink-4)]">Обновите страницу или попробуйте позже.</p>
      </div>
    )
  }

  const generatePrice = prices?.generate ?? 100
  const docsLeft = Math.floor((balance ?? 0) / generatePrice)

  return (
    <div className="max-w-[860px]">
      <div className="mb-[24px]">
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 400 }}>Баланс</h2>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_280px] gap-[20px]">
        {/* Левая колонка */}
        <div className="flex flex-col gap-[16px]">

          {/* Большой баланс */}
          <Card>
            <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[8px]">Доступно</p>
            <p className="leading-[1] mb-[4px]" style={{ fontFamily: 'var(--font-serif)', fontSize: 52, fontWeight: 400 }}>
              {formatMoney(balance ?? 0)}
              <span className="text-[var(--ink-3)] ml-[10px]" style={{ fontSize: 24 }}>токенов</span>
            </p>
            <p className="text-[12px] text-[var(--ink-4)]">
              Хватит примерно на {docsLeft} {pluralDocs(docsLeft)} с проверками
            </p>
          </Card>

          {/* Пояснение: пополнение появится позже */}
          <Card>
            <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[10px]">Пополнение</p>
            <p className="text-[13px] text-[var(--ink-2)] leading-[1.6]">
              Токены списываются за генерацию документов, пакеты правок, проверку и анализ.
              Пополнение появится вместе с подключением платёжного шлюза.
            </p>
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
                    {tx.type === 'CREDIT' ? '+' : '−'}{formatAmount(tx)}
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
                  Здесь появится история списаний токенов
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
                { label: 'Генерация документа', value: formatTokens(prices?.generate ?? 100) },
                { label: `Пакет ${prices?.editsPerPackage ?? 10} действий Догодка`, value: 'включён' },
                { label: 'Работа с загруженным', value: formatTokens(prices?.uploadEditStart ?? 50) },
                { label: 'Правки и вопросы в чате', value: 'из пакета' },
                { label: 'Проверка рисков', value: formatTokens(prices?.review ?? 25) },
                { label: 'Анализ при загрузке', value: formatTokens(prices?.analyzeUpload ?? 25) },
                { label: 'Ручное редактирование', value: 'Бесплатно' },
                { label: 'Скачивание и печать', value: 'Бесплатно' },
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
              <p>Вы предоплачиваете действие токенами — как во многих подобных сервисах.</p>
              <p>В оплаченную генерацию входит пакет из {prices?.editsPerPackage ?? 10} правок Догодка.</p>
              <p>Готовый документ сразу можно копировать, скачивать и печатать — без доплат.</p>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

function pluralDocs(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return 'документ'
  if ([2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100)) return 'документа'
  return 'документов'
}
