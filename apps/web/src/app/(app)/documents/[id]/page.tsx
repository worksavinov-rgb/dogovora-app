'use client'

import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/badge'
import { Avatar } from '@/components/ui/avatar'
import { useToast } from '@/components/ui/toast'

// ─── Типы ─────────────────────────────────────────────────────────────────────

interface Purchase { id: string; amount: string }
interface Version {
  id: string; number: number; status: string
  fileSize: number | null; createdAt: string
  aiSettings: {
    protectionLevel?: number; targetSize?: number
    customInstruction?: string; description?: string
  }
  purchase: Purchase | null
}
interface Signatory { id: string; fullName: string; position: string }
interface Counterparty { id: string; name: string; inn: string | null; signatories: Signatory[] }
interface Document {
  id: string; title: string; number: string | null; type: string
  createdAt: string; updatedAt: string
  counterparty: Counterparty
  versions: Version[]
}

// ─── Утилиты ──────────────────────────────────────────────────────────────────

const TYPE_LABELS: Record<string, string> = { CONTRACT: 'Договор', APPENDIX: 'Приложение', AMENDMENT: 'Доп. соглашение' }
const STATUS_MAP: Record<string, 'draft'|'progress'|'review'|'approved'|'paid'> = {
  DRAFT:'draft', IN_PROGRESS:'progress', REVIEW:'review', APPROVED:'approved', PAID:'paid'
}

function relDate(iso: string): string {
  const d = new Date(iso), now = new Date()
  const diff = Math.floor((now.getTime() - d.getTime()) / 86400000)
  if (diff === 0) return `${d.toLocaleDateString('ru', {day:'numeric',month:'short'})}, ${d.toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'})}`
  if (diff === 1) return 'вчера'
  return d.toLocaleDateString('ru', { day:'numeric', month:'short' })
}

// ─── Модалка покупки ──────────────────────────────────────────────────────────

function PurchaseModal({
  ver, docTitle, balance, onConfirm, onClose, loading,
}: {
  ver: Version; docTitle: string; balance: number | null
  onConfirm: () => void; onClose: () => void; loading: boolean
}) {
  const price = 540
  const hasEnough = balance !== null && balance >= price

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-[var(--radius-xl)] shadow-xl w-[400px]" style={{ padding: '28px' }}>
        <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[16px]">
          Подтверждение покупки
        </p>

        <div className="mb-[20px]">
          <p className="text-[13px] text-[var(--ink-3)] mb-[2px]">{docTitle}</p>
          <p className="text-[15px] font-medium text-[var(--ink)]" style={{ fontFamily: 'var(--font-mono)' }}>
            Версия v.{ver.number}
          </p>
        </div>

        <div className="rounded-[var(--radius-md)] mb-[16px]"
          style={{ background: 'var(--surface-inset)', padding: '12px 14px' }}>
          {[
            { label: 'Стоимость версии', value: `${price} ₽` },
            { label: 'Ваш баланс', value: balance !== null ? `${balance.toLocaleString('ru')} ₽` : '…' },
            { label: 'После списания', value: balance !== null ? `${(balance - price).toLocaleString('ru')} ₽` : '…', bold: true },
          ].map((row) => (
            <div key={row.label} className="flex justify-between items-center py-[5px]">
              <p className="text-[12px] text-[var(--ink-4)]">{row.label}</p>
              <p className={['text-[13px]', row.bold ? 'font-medium text-[var(--ink)]' : 'text-[var(--ink-2)]'].join(' ')}
                style={{ fontFamily: 'var(--font-mono)' }}>
                {row.value}
              </p>
            </div>
          ))}
        </div>

        {!hasEnough && balance !== null && (
          <div className="rounded-[var(--radius-md)] mb-[16px] px-[12px] py-[10px]"
            style={{ background: 'oklch(0.96 0.025 20)', border: '1px solid oklch(0.88 0.04 20)' }}>
            <p className="text-[12px] text-[var(--danger)]">
              Недостаточно средств. Пополните баланс на странице «Баланс».
            </p>
          </div>
        )}

        <p className="text-[11px] text-[var(--ink-4)] mb-[16px]">
          После покупки документ доступен для скачивания неограниченное количество раз бесплатно.
        </p>

        <div className="flex gap-[8px]">
          <button onClick={onClose}
            className="flex-1 h-[40px] rounded-[var(--radius-md)] text-[13px] font-medium bg-[var(--surface-inset)] text-[var(--ink-2)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer">
            Отмена
          </button>
          <button onClick={onConfirm} disabled={loading || !hasEnough}
            className="flex-1 h-[40px] rounded-[var(--radius-md)] text-[13px] font-medium bg-[var(--ink)] text-[var(--bg)] hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-40">
            {loading ? 'Покупаю…' : `Купить · ${price} ₽`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Компонент строки версии ──────────────────────────────────────────────────

function VersionRow({
  ver, isCurrent, doc, onBuy,
}: {
  ver: Version; isCurrent: boolean; doc: Document; onBuy: (ver: Version) => void
}) {
  const router = useRouter()

  return (
    <div className={['px-[20px] py-[14px] border-b border-[var(--line)] last:border-0', isCurrent ? 'bg-[var(--surface-inset)]' : ''].join(' ')}>
      <div className="flex items-start gap-[12px]">
        <div className="shrink-0 w-[44px]">
          <p className="text-[12px] font-medium text-[var(--ink-4)]" style={{ fontFamily:'var(--font-mono)' }}>v.{ver.number}</p>
          {isCurrent && <p className="text-[10px] text-[var(--ink-4)] uppercase tracking-[0.06em]">Текущая</p>}
        </div>

        <div className="flex-1 min-w-0">
          {ver.aiSettings?.description ? (
            <p className="text-[13px] text-[var(--ink)] mb-[2px] line-clamp-2">{ver.aiSettings.description}</p>
          ) : (
            <p className="text-[13px] text-[var(--ink-3)] mb-[2px] italic">Черновик без описания</p>
          )}
          <p className="text-[12px] text-[var(--ink-4)]">{relDate(ver.createdAt)}</p>
        </div>

        <div className="flex items-center gap-[8px] shrink-0">
          <StatusBadge status={STATUS_MAP[ver.status] ?? 'draft'} />

          {ver.purchase ? (
            <button
              onClick={() => router.push(`/documents/${doc.id}/work?version=${ver.id}`)}
              className="h-[28px] px-[10px] text-[12px] font-medium text-[var(--ink-3)] hover:text-[var(--ink)] transition-colors cursor-pointer flex items-center gap-[4px]"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              Открыть
            </button>
          ) : ver.status === 'APPROVED' ? (
            <button
              onClick={() => onBuy(ver)}
              className="h-[28px] px-[10px] text-[12px] font-medium bg-[var(--ink)] text-[var(--bg)] rounded-[var(--radius-md)] hover:opacity-90 transition-opacity cursor-pointer"
            >
              Купить · 540 ₽
            </button>
          ) : (
            <button
              onClick={() => router.push(`/documents/${doc.id}/work?version=${ver.id}`)}
              className="h-[28px] px-[10px] text-[12px] font-medium text-[var(--ink-3)] hover:text-[var(--ink)] transition-colors cursor-pointer"
            >
              Открыть
            </button>
          )}

          <button className="w-[28px] h-[28px] flex items-center justify-center text-[var(--ink-4)] hover:text-[var(--ink)] transition-colors cursor-pointer">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Главная страница ─────────────────────────────────────────────────────────

export default function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const { toast: showToast } = useToast()
  const [doc, setDoc] = useState<Document | null>(null)
  const [loading, setLoading] = useState(true)
  const [balance, setBalance] = useState<number | null>(null)
  const [buyingVer, setBuyingVer] = useState<Version | null>(null)
  const [purchasing, setPurchasing] = useState(false)

  async function loadDoc() {
    const res = await fetch(`/api/documents/${id}`)
    if (res.ok) setDoc(await res.json())
    else router.push('/documents')
  }

  useEffect(() => {
    Promise.all([
      loadDoc(),
      fetch('/api/wallet').then((r) => r.ok ? r.json() : null).then((w) => w && setBalance(w.balance)),
    ]).finally(() => setLoading(false))
  }, [id])

  async function handlePurchase() {
    if (!buyingVer) return
    setPurchasing(true)
    try {
      const res = await fetch(`/api/versions/${buyingVer.id}/purchase`, { method: 'POST' })
      const data = await res.json()

      if (res.status === 402) {
        showToast('Недостаточно средств — пополните баланс', 'error')
        setBuyingVer(null)
        return
      }
      if (!res.ok) {
        showToast('Ошибка при покупке. Попробуйте ещё раз.', 'error')
        return
      }

      showToast(data.alreadyPurchased ? 'Уже куплено ранее' : 'Версия успешно куплена!', 'success')
      setBuyingVer(null)
      // Обновляем баланс и документ
      const [walletRes] = await Promise.all([
        fetch('/api/wallet').then((r) => r.ok ? r.json() : null),
        loadDoc(),
      ])
      if (walletRes) setBalance(walletRes.balance)
    } finally {
      setPurchasing(false)
    }
  }

  if (loading) {
    return (
      <div className="max-w-[1080px]">
        <div className="mb-[20px]">
          <div className="flex items-center gap-[10px] mb-[8px]">
            <div className="h-[14px] w-[60px] rounded bg-[var(--surface-inset)] animate-pulse" />
          </div>
          <div className="h-[32px] w-[55%] rounded bg-[var(--surface-inset)] animate-pulse mb-[8px]" />
          <div className="h-[14px] w-[30%] rounded bg-[var(--surface-inset)] animate-pulse" />
        </div>
        <div className="grid grid-cols-[1fr_300px] gap-[16px]">
          <div className="h-[400px] rounded-[var(--radius-lg)] bg-[var(--surface-inset)] animate-pulse" />
          <div className="h-[400px] rounded-[var(--radius-lg)] bg-[var(--surface-inset)] animate-pulse" />
        </div>
      </div>
    )
  }

  if (!doc) return null

  const currentVersion = doc.versions[0]
  const aiS = currentVersion?.aiSettings ?? {}

  return (
    <>
      {buyingVer && (
        <PurchaseModal
          ver={buyingVer}
          docTitle={doc.title}
          balance={balance}
          onConfirm={handlePurchase}
          onClose={() => setBuyingVer(null)}
          loading={purchasing}
        />
      )}

      <div className="max-w-[1080px]">
        {/* Заголовок */}
        <div className="mb-[20px]">
          <div className="flex items-center gap-[10px] mb-[8px]">
            <span className="text-[12px] text-[var(--ink-4)]">{TYPE_LABELS[doc.type] ?? doc.type}</span>
            {doc.number && <span className="text-[12px] text-[var(--ink-4)]">· № {doc.number}</span>}
            {currentVersion && <StatusBadge status={STATUS_MAP[currentVersion.status] ?? 'draft'} />}
          </div>
          <div className="flex items-start justify-between gap-[16px]">
            <h2 style={{ fontFamily:'var(--font-display)', fontSize:28, fontWeight:400, lineHeight:1.2 }}>
              {doc.title}
            </h2>
            <div className="flex items-center gap-[8px] shrink-0">
              <Button variant="secondary" onClick={() => router.push(`/documents/${id}/compare`)}>⇄ Сравнить версии</Button>
              <Button variant="primary" onClick={() => router.push(`/documents/${id}/work`)}>
                ✦ Открыть в ИИ-чате
              </Button>
            </div>
          </div>
          <p className="text-[13px] text-[var(--ink-3)] mt-[6px]">
            <span className="text-[var(--ink-2)] font-medium">{doc.counterparty.name}</span>
            {currentVersion && ` · текущая версия v.${currentVersion.number} · обновлена ${relDate(doc.updatedAt)}`}
          </p>
        </div>

        <div className="grid grid-cols-[1fr_260px] gap-[20px]">
          {/* Левая колонка — история версий */}
          <div>
            <div className="flex items-center justify-between mb-[12px]">
              <p className="text-[13px] font-medium text-[var(--ink)]">История версий</p>
              <button
                onClick={() => router.push(`/documents/${id}/compare`)}
                className="text-[12px] text-[var(--ink-3)] hover:text-[var(--ink)] transition-colors cursor-pointer flex items-center gap-[4px]">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
                Сравнить
              </button>
            </div>

            <Card pad={false}>
              {doc.versions.length === 0 ? (
                <div className="py-[40px] text-center">
                  <p className="text-[13px] text-[var(--ink-4)]">Версий пока нет</p>
                </div>
              ) : (
                doc.versions.map((ver, i) => (
                  <VersionRow key={ver.id} ver={ver} isCurrent={i === 0} doc={doc} onBuy={setBuyingVer} />
                ))
              )}
            </Card>
          </div>

          {/* Правая колонка */}
          <div className="flex flex-col gap-[12px]">
            <Card>
              <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[12px]">Быстрые действия</p>
              <div className="flex flex-col gap-[6px]">
                {[
                  { icon: '✦', label: 'Открыть в ИИ-чате', primary: true, onClick: () => router.push(`/documents/${id}/work`) },
                  { icon: '⇄', label: `Сравнить с v.${Math.max(1, (currentVersion?.number ?? 1) - 1)}`, primary: false, onClick: () => router.push(`/documents/${id}/compare`) },
                  { icon: '◎', label: 'Проверить риски', primary: false, onClick: () => router.push(`/documents/${id}/check`) },
                  { icon: '⬡', label: currentVersion?.purchase ? 'Скачать · уже куплено' : `Купить версию · 540 ₽`, primary: false, onClick: () => currentVersion && !currentVersion.purchase && setBuyingVer(currentVersion) },
                  { icon: '⊕', label: 'Дублировать как ДС', primary: false },
                ].map((action) => (
                  <button key={action.label} onClick={action.onClick}
                    className={['w-full text-left px-[12px] py-[9px] rounded-[var(--radius-md)] text-[13px] font-medium transition-colors cursor-pointer flex items-center gap-[8px]',
                      action.primary ? 'bg-[var(--ink)] text-[var(--bg)] hover:opacity-90' : 'bg-[var(--surface-inset)] text-[var(--ink-2)] hover:bg-[var(--surface-2)]',
                    ].join(' ')}>
                    <span className="text-[14px]">{action.icon}</span>
                    {action.label}
                  </button>
                ))}
              </div>
            </Card>

            <Card>
              <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[12px]">Параметры документа</p>
              <div className="flex flex-col gap-[8px] text-[13px]">
                {[
                  { label: 'Тип', value: TYPE_LABELS[doc.type] ?? doc.type },
                  { label: 'Контрагент', value: doc.counterparty.name },
                  ...(doc.number ? [{ label: 'Номер', value: doc.number }] : []),
                  { label: 'Дата', value: new Date(doc.createdAt).toLocaleDateString('ru', { day:'numeric', month:'long', year:'numeric' }) },
                  ...(aiS.protectionLevel !== undefined ? [{ label: 'Защищённость', value: `${aiS.protectionLevel}%` }] : []),
                  ...(aiS.targetSize ? [{ label: 'Объём', value: `~ ${Number(aiS.targetSize).toLocaleString('ru')} знаков` }] : []),
                ].map((row) => (
                  <div key={row.label} className="flex justify-between gap-[8px]">
                    <p className="text-[var(--ink-4)] shrink-0">{row.label}</p>
                    <p className="text-[var(--ink-2)] text-right">{row.value}</p>
                  </div>
                ))}
              </div>
            </Card>

            {doc.counterparty.signatories.length > 0 && (
              <Card>
                <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[10px]">Подписант</p>
                <div className="flex items-center gap-[8px]">
                  <Avatar name={doc.counterparty.signatories[0].fullName} size={28} />
                  <div>
                    <p className="text-[12px] font-medium">{doc.counterparty.signatories[0].fullName}</p>
                    <p className="text-[11px] text-[var(--ink-4)]">{doc.counterparty.signatories[0].position}</p>
                  </div>
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>
    </>
  )
}
