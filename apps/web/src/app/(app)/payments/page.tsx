'use client'

import { useState, useEffect } from 'react'
import { Card } from '@/components/ui/card'

interface Transaction {
  id: string
  type: 'CREDIT' | 'DEBIT'
  amount: number
  description: string
  createdAt: string
  document: string | null
}

function formatMoney(n: number): string {
  return n.toLocaleString('ru', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric' })
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })
}

// Группируем транзакции по дате
function groupByDate(txs: Transaction[]): Record<string, Transaction[]> {
  const result: Record<string, Transaction[]> = {}
  for (const tx of txs) {
    const key = new Date(tx.createdAt).toLocaleDateString('ru')
    if (!result[key]) result[key] = []
    result[key].push(tx)
  }
  return result
}

export default function PaymentsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([])
  const [balance, setBalance] = useState<number>(0)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)
  const PER_PAGE = 20

  useEffect(() => {
    fetch(`/api/wallet/transactions?limit=${PER_PAGE}&offset=${page * PER_PAGE}`)
      .then((r) => r.ok ? r.json() : { items: [], total: 0, balance: 0 })
      .then((data) => {
        setTransactions(data.items ?? [])
        setTotal(data.total ?? 0)
        setBalance(data.balance ?? 0)
      })
      .finally(() => setLoading(false))
  }, [page])

  // Сводные цифры
  const credited = transactions.filter((t) => t.type === 'CREDIT').reduce((s, t) => s + t.amount, 0)
  const debited  = transactions.filter((t) => t.type === 'DEBIT').reduce((s, t) => s + t.amount, 0)
  const grouped  = groupByDate(transactions)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-[120px]">
        <div className="w-[24px] h-[24px] border-2 border-[var(--line)] border-t-[var(--ink)] rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-[860px]">
      <div className="mb-[24px]">
        <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 400 }}>
          История платежей
        </h2>
      </div>

      {/* Summary плитки */}
      <div className="grid grid-cols-3 gap-[12px] mb-[20px]">
        {[
          { label: 'Текущий баланс', value: `${formatMoney(balance)} ₽`, mono: true, accent: false },
          { label: 'Пополнено', value: `+ ${formatMoney(credited)} ₽`, mono: true, accent: true },
          { label: 'Потрачено', value: `− ${formatMoney(debited)} ₽`, mono: true, accent: false },
        ].map((card) => (
          <Card key={card.label}>
            <p className="text-[11px] text-[var(--ink-4)] mb-[6px]">{card.label}</p>
            <p
              className="text-[22px] font-medium"
              style={{
                fontFamily: card.mono ? 'var(--font-mono)' : undefined,
                color: card.accent ? 'oklch(0.45 0.1 145)' : 'var(--ink)',
              }}
            >
              {card.value}
            </p>
          </Card>
        ))}
      </div>

      {/* Таблица */}
      {transactions.length === 0 ? (
        <Card>
          <div className="py-[48px] text-center">
            <p className="text-[15px] text-[var(--ink-3)]" style={{ fontFamily: 'var(--font-serif)' }}>
              Операций пока нет
            </p>
            <p className="text-[12px] text-[var(--ink-4)] mt-[6px]">
              Пополните баланс на странице «Баланс»
            </p>
          </div>
        </Card>
      ) : (
        <Card pad={false}>
          {/* Шапка таблицы */}
          <div
            className="grid px-[20px] py-[10px]"
            style={{
              gridTemplateColumns: '1fr 140px 100px 90px',
              borderBottom: '1px solid var(--line)',
            }}
          >
            {['Описание', 'Дата', 'Тип', 'Сумма'].map((col) => (
              <p key={col} className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.06em]">
                {col}
              </p>
            ))}
          </div>

          {/* Строки, сгруппированные по дате */}
          {Object.entries(grouped).map(([dateKey, txs]) => (
            <div key={dateKey}>
              {/* Eyebrow-заголовок даты */}
              <div className="px-[20px] py-[8px]" style={{ background: 'var(--surface-inset)', borderBottom: '1px solid var(--line)' }}>
                <p className="text-[11px] font-medium text-[var(--ink-4)]">{formatDate(txs[0].createdAt)}</p>
              </div>

              {txs.map((tx) => (
                <div
                  key={tx.id}
                  className="grid items-center px-[20px] py-[12px]"
                  style={{
                    gridTemplateColumns: '1fr 140px 100px 90px',
                    borderBottom: '1px solid var(--line)',
                  }}
                >
                  {/* Описание */}
                  <div className="flex items-center gap-[10px] min-w-0 pr-[12px]">
                    <div
                      className="shrink-0 w-[28px] h-[28px] rounded-full flex items-center justify-center text-[11px] font-bold"
                      style={{
                        background: tx.type === 'CREDIT' ? 'oklch(0.95 0.02 145)' : 'oklch(0.96 0.025 20)',
                        color: tx.type === 'CREDIT' ? 'oklch(0.45 0.1 145)' : 'var(--danger)',
                      }}
                    >
                      {tx.type === 'CREDIT' ? '+' : '−'}
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13px] text-[var(--ink)] truncate">{tx.description}</p>
                      {tx.document && (
                        <p className="text-[11px] text-[var(--ink-4)] truncate">{tx.document}</p>
                      )}
                    </div>
                  </div>

                  {/* Дата */}
                  <p className="text-[12px] text-[var(--ink-4)]">{formatTime(tx.createdAt)}</p>

                  {/* Тип */}
                  <span
                    className="inline-flex items-center px-[8px] h-[20px] rounded-full text-[10px] font-medium w-fit"
                    style={{
                      background: tx.type === 'CREDIT' ? 'oklch(0.95 0.02 145)' : 'oklch(0.96 0.025 20)',
                      color: tx.type === 'CREDIT' ? 'oklch(0.45 0.1 145)' : 'var(--danger)',
                    }}
                  >
                    {tx.type === 'CREDIT' ? 'Пополнение' : 'Списание'}
                  </span>

                  {/* Сумма */}
                  <p
                    className="text-[14px] font-medium text-right"
                    style={{
                      fontFamily: 'var(--font-mono)',
                      color: tx.type === 'CREDIT' ? 'oklch(0.45 0.1 145)' : 'var(--ink)',
                    }}
                  >
                    {tx.type === 'CREDIT' ? '+' : '−'}{formatMoney(tx.amount)} ₽
                  </p>
                </div>
              ))}
            </div>
          ))}

          {/* Пагинация */}
          {total > PER_PAGE && (
            <div className="flex items-center justify-between px-[20px] py-[12px]">
              <p className="text-[12px] text-[var(--ink-4)]">
                Показано {Math.min((page + 1) * PER_PAGE, total)} из {total}
              </p>
              <div className="flex gap-[6px]">
                <button
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  className="h-[28px] px-[10px] text-[12px] rounded-[var(--radius-md)] bg-[var(--surface-inset)] text-[var(--ink-3)] hover:text-[var(--ink)] transition-colors cursor-pointer disabled:opacity-40"
                >
                  ← Назад
                </button>
                <button
                  onClick={() => setPage((p) => p + 1)}
                  disabled={(page + 1) * PER_PAGE >= total}
                  className="h-[28px] px-[10px] text-[12px] rounded-[var(--radius-md)] bg-[var(--surface-inset)] text-[var(--ink-3)] hover:text-[var(--ink)] transition-colors cursor-pointer disabled:opacity-40"
                >
                  Вперёд →
                </button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
