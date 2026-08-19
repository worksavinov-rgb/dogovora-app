'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Card } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

// ─── Типы ─────────────────────────────────────────────────────────────────────

interface RecentDoc {
  id: string
  title: string
  type: string
  updatedAt: string
  counterparty: { name: string }
  versions: {
    id: string
    number: number
    status: string
  }[]
}

interface DeadlineItem {
  documentId: string
  title: string
  counterpartyName: string | null
  autoRenewal: boolean
  daysLeft: number
}

interface WalletData { balance: number }
interface StorageData { usedBytes: number; totalDocs: number; totalVersions: number }

// ─── Утилиты ──────────────────────────────────────────────────────────────────

const TYPE_ICONS: Record<string, string> = {
  CONTRACT: '⊡', APPENDIX: '⊞', AMENDMENT: '⊟',
}

const STATUS_MAP: Record<string, 'draft'|'progress'|'review'|'approved'|'paid'> = {
  DRAFT:'draft', IN_PROGRESS:'progress', REVIEW:'review', APPROVED:'approved', PAID:'paid',
}

function formatBytes(b: number) {
  if (b < 1024 * 1024) return `${Math.round(b / 1024)} КБ`
  return `${(b / (1024 * 1024)).toFixed(1)} МБ`
}

function relDate(iso: string) {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000)
  if (diff === 0) return 'сегодня'
  if (diff === 1) return 'вчера'
  return new Date(iso).toLocaleDateString('ru', { day: 'numeric', month: 'short' })
}

function getDayOfWeek() {
  const days = ['Воскресенье', 'Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота']
  return days[new Date().getDay()]
}

function getDateStr() {
  return new Date().toLocaleDateString('ru', { day: 'numeric', month: 'long' })
}

// ─── Quick action карточка ────────────────────────────────────────────────────

function QuickAction({ icon, label, sub, onClick, highlight }: {
  icon: string; label: string; sub: string; onClick: () => void; highlight?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className="relative w-full text-left rounded-[var(--radius-lg)] p-[16px] transition-all cursor-pointer group"
      style={
        highlight
          ? { background: 'var(--accent-soft)', border: '1px solid var(--accent)', boxShadow: '0 1px 6px rgba(0,0,0,0.08)' }
          : { background: '#ffffff', border: '1px solid var(--line-2)', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }
      }
      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = highlight ? '0 3px 10px rgba(0,0,0,0.12)' : '0 2px 8px rgba(0,0,0,0.1)'; if (!highlight) e.currentTarget.style.borderColor = 'var(--ink-3)' }}
      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = highlight ? '0 1px 6px rgba(0,0,0,0.08)' : '0 1px 4px rgba(0,0,0,0.06)'; if (!highlight) e.currentTarget.style.borderColor = 'var(--line-2)' }}
    >
      {highlight && (
        <span
          className="absolute top-[10px] right-[10px] text-[9px] font-semibold uppercase tracking-[0.04em] px-[6px] py-[2px] rounded-full"
          style={{ color: 'var(--accent)', background: '#ffffff', border: '1px solid var(--accent)' }}
        >
          Популярно
        </span>
      )}
      <div
        className="w-[32px] h-[32px] rounded-[var(--radius-md)] flex items-center justify-center mb-[12px] text-[16px]"
        style={{ background: highlight ? 'var(--accent)' : 'var(--surface-inset)', color: highlight ? '#fff' : 'inherit' }}
      >
        {icon}
      </div>
      <p className="text-[13px] font-medium text-[var(--ink)] mb-[2px]">{label}</p>
      <p className="text-[11px] text-[var(--ink-4)]">{sub}</p>
    </button>
  )
}

// ─── Главная страница ─────────────────────────────────────────────────────────

export default function HomePage() {
  const router = useRouter()
  const [docs, setDocs] = useState<RecentDoc[]>([])
  const [wallet, setWallet] = useState<WalletData | null>(null)
  const [storage, setStorage] = useState<StorageData | null>(null)
  const [deadlines, setDeadlines] = useState<DeadlineItem[]>([])
  const [userName, setUserName] = useState<string | null>(null)
  const [myProfileName, setMyProfileName] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Загружаем всё параллельно
    Promise.all([
      fetch('/api/documents?limit=5').then((r) => r.ok ? r.json() : { items: [] }),
      fetch('/api/wallet').then((r) => r.ok ? r.json() : null),
      fetch('/api/storage').then((r) => r.ok ? r.json() : null),
      fetch('/api/auth/me').then((r) => r.ok ? r.json() : null),
      fetch('/api/profiles').then((r) => r.ok ? r.json() : []),
      fetch('/api/documents/deadlines').then((r) => r.ok ? r.json() : { items: [] }),
    ]).then(([docsData, walletData, storageData, meData, profilesData, deadlinesData]) => {
      setDocs(docsData.items ?? [])
      setWallet(walletData)
      setStorage(storageData)
      setLoading(false)
      if (meData?.email) {
        setUserName(meData.email.split('@')[0])
      }
      const firstProfile = Array.isArray(profilesData) ? profilesData[0] : null
      if (firstProfile?.name) setMyProfileName(firstProfile.name)

      setDeadlines(deadlinesData?.items ?? [])
    }).catch(() => {
      // Любая упавшая ручка раньше оставляла главную на вечных скелетонах
      setLoading(false)
    })
  }, [])


  return (
    <div className="max-w-[1080px]">

      {/* Приветствие */}
      <div className="mb-[28px]">
        <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[6px]">
          {getDayOfWeek()}, {getDateStr()}
        </p>
        <h1 style={{ fontFamily: 'var(--font-display)', fontSize: 30, fontWeight: 400, marginBottom: 6 }}>
          Доброе утро{userName ? `, ${userName}` : ''}!
        </h1>
        <p className="text-[14px] text-[var(--ink-3)]">
          Создайте договор или откройте существующий для работы.
        </p>
      </div>

      {/* Единая сетка: карточки и контент выровнены по одной оси */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_280px] gap-[16px]">

        {/* Левая колонка */}
        <div className="flex flex-col gap-[12px]">
          {/* 3 quick actions */}
          <div className="grid grid-cols-3 gap-[12px]">
            <QuickAction icon="+" label="Создать договор" sub="Новый документ с Догодком"
              onClick={() => router.push('/documents/new')} />
            <QuickAction icon="↑" label="Загрузить документ" sub="Анализ и проверка Догодком"
              onClick={() => router.push('/documents/upload')} highlight />
            <QuickAction icon="☰" label="Все документы" sub={docs.length > 0 ? `${docs.length} в архиве` : 'Архив договоров'}
              onClick={() => router.push('/documents')} />
          </div>

        {/* Недавние документы */}
        <Card pad={false}>
          <div className="flex items-center justify-between px-[20px] py-[14px]" style={{ borderBottom: '1px solid var(--line)' }}>
            <p className="text-[13px] font-medium text-[var(--ink)]">Недавние документы</p>
            <button
              onClick={() => router.push('/documents')}
              className="text-[12px] text-[var(--accent)] hover:opacity-70 transition-opacity cursor-pointer"
            >
              Все документы →
            </button>
          </div>

          {/* Шапка колонок */}
          <div className="grid grid-cols-[1fr_auto_auto_auto] gap-[12px] items-center px-[20px] py-[7px]"
            style={{ borderBottom: '1px solid var(--line)', background: 'var(--surface-inset)' }}>
            <p className="text-[10px] font-semibold text-[var(--ink-4)] uppercase tracking-[0.08em]">Название</p>
            <p className="text-[10px] font-semibold text-[var(--ink-4)] uppercase tracking-[0.08em]">Статус</p>
            <p className="text-[10px] font-semibold text-[var(--ink-4)] uppercase tracking-[0.08em]">Версия</p>
            <p className="text-[10px] font-semibold text-[var(--ink-4)] uppercase tracking-[0.08em]">Дата</p>
          </div>

          {loading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-[12px] px-[20px] py-[12px]" style={{ borderBottom: '1px solid var(--line)' }}>
                <Skeleton className="w-[28px] h-[28px] shrink-0" />
                <div className="flex-1 flex flex-col gap-[6px]">
                  <Skeleton className="h-[12px] w-[55%]" />
                  <Skeleton className="h-[10px] w-[30%]" />
                </div>
                <Skeleton className="h-[20px] w-[64px] rounded-full" />
                <Skeleton className="h-[10px] w-[24px]" />
              </div>
            ))
          ) : docs.length === 0 ? (
            <div className="py-[48px] flex flex-col items-center gap-[10px]">
              <div className="w-[40px] h-[40px] rounded-full bg-[var(--surface-inset)] flex items-center justify-center">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--ink-4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              </div>
              <p className="text-[14px] text-[var(--ink-3)]" style={{ fontFamily: 'var(--font-serif)' }}>
                Документов пока нет
              </p>
              <p className="text-[12px] text-[var(--ink-4)]">
                Создайте первый договор
              </p>
              <button
                onClick={() => router.push('/documents/new')}
                className="h-[34px] px-[16px] rounded-[var(--radius-md)] text-[12px] font-medium bg-[var(--ink)] text-[var(--bg)] hover:opacity-90 transition-opacity cursor-pointer"
              >
                + Новый документ
              </button>
            </div>
          ) : (
            docs.map((doc) => {
              const currentVer = doc.versions[0]
              return (
                <div
                  key={doc.id}
                  onClick={() => router.push(`/documents/${doc.id}`)}
                  className="flex items-center gap-[12px] px-[20px] py-[12px] cursor-pointer hover:bg-[var(--surface-inset)] transition-colors"
                  style={{ borderBottom: '1px solid var(--line)' }}
                >
                  {/* Иконка типа */}
                  <div
                    className="shrink-0 w-[28px] h-[28px] rounded-[var(--radius-sm)] flex items-center justify-center text-[13px]"
                    style={{ background: 'var(--surface-inset)', color: 'var(--ink-4)' }}
                  >
                    {TYPE_ICONS[doc.type] ?? '⊡'}
                  </div>

                  {/* Название + стороны */}
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-[var(--ink)] truncate">{doc.title}</p>
                    <p className="text-[11px] text-[var(--ink-4)] truncate">
                      {myProfileName
                        ? <>{myProfileName} <span className="text-[var(--ink-4)] mx-[3px]">↔</span> {doc.counterparty.name}</>
                        : doc.counterparty.name}
                    </p>
                  </div>

                  {/* Статус */}
                  {currentVer && (
                    <StatusBadge status={STATUS_MAP[currentVer.status] ?? 'draft'} />
                  )}

                  {/* Версия */}
                  {currentVer && (
                    <span className="shrink-0 text-[11px] text-[var(--ink-4)]" style={{ fontFamily: 'var(--font-mono)' }}>
                      v.{currentVer.number}
                    </span>
                  )}

                  {/* Дата */}
                  <span className="shrink-0 text-[11px] text-[var(--ink-4)]">
                    {relDate(doc.updatedAt)}
                  </span>
                </div>
              )
            })
          )}
        </Card>
        </div>{/* /Левая колонка */}

        {/* Правая колонка */}
        <div className="flex flex-col gap-[12px]">

          {/* Баланс */}
          <Card>
            <div className="flex flex-col" style={{ gap: 14 }}>
              <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em]">Баланс</p>
              <p className="leading-none" style={{ fontFamily: 'var(--font-serif)', fontSize: 36, fontWeight: 400 }}>
                {wallet ? wallet.balance.toLocaleString('ru') : '…'}
                <span className="text-[var(--ink-3)] ml-[8px]" style={{ fontSize: 17 }}>токенов</span>
              </p>
              <p className="text-[12px] text-[var(--ink-4)]">
                ≈ {wallet ? Math.floor(wallet.balance / 100) : 0} документов с проверками
              </p>
              <button
                onClick={() => router.push('/balance')}
                className="w-full h-[38px] rounded-[var(--radius-md)] text-[13px] font-medium bg-[var(--ink)] text-[var(--bg)] hover:opacity-90 transition-opacity cursor-pointer"
              >
                Открыть баланс
              </button>
            </div>
          </Card>

          {/* Ближайшие сроки договоров */}
          {deadlines.length > 0 && (
            <Card>
              <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[10px]">Ближайшие сроки</p>
              <div className="flex flex-col gap-[10px]">
                {deadlines.slice(0, 3).map((d) => (
                  <button
                    key={d.documentId}
                    onClick={() => router.push(`/documents/${d.documentId}`)}
                    className="text-left cursor-pointer group"
                  >
                    <p className="text-[12px] font-medium text-[var(--ink)] group-hover:underline truncate">{d.title}</p>
                    <p className="text-[11px] leading-[1.5]" style={{ color: d.daysLeft <= 7 ? 'var(--danger)' : 'var(--ink-4)' }}>
                      {d.autoRenewal
                        ? d.daysLeft > 0
                          ? `автопролонгация: отказ возможен ещё ${d.daysLeft} дн.`
                          : 'продлён автоматически'
                        : d.daysLeft > 0
                          ? `истекает через ${d.daysLeft} дн.`
                          : 'срок истёк'}
                    </p>
                  </button>
                ))}
              </div>
            </Card>
          )}

          {/* Хранилище: лимитов нет — показываем только занятое место */}
          <Card>
            <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.1em] mb-[10px]">Хранилище</p>
            <div className="flex items-center justify-between mb-[8px]">
              <p className="text-[12px] text-[var(--ink-2)]">
                {storage ? `Занято ${formatBytes(storage.usedBytes)}` : '…'}
              </p>
            </div>
            <p className="text-[11px] text-[var(--ink-4)]">
              {storage
                ? `${storage.totalDocs} документов · ${storage.totalVersions} версий`
                : 'Файлов пока нет'}
            </p>
          </Card>
        </div>
      </div>
    </div>
  )
}
