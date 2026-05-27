'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

/* ─── Иконки (inline SVG) ─────────────────────────────────────────────────── */

function IconHome() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9.5z"/><path d="M9 21V12h6v9"/></svg>
}
function IconUsers() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
}
function IconFiles() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
}
function IconClock() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
}
function IconWallet() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M16 12h.01"/><path d="M2 10h20"/></svg>
}
function IconReceipt() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 2v20l3-3 3 3 3-3 3 3 3-3V2z"/><line x1="9" y1="7" x2="15" y2="7"/><line x1="9" y1="11" x2="15" y2="11"/><line x1="9" y1="15" x2="12" y2="15"/></svg>
}
function IconHardDrive() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="12" x2="2" y2="12"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><line x1="6" y1="16" x2="6.01" y2="16"/><line x1="10" y1="16" x2="10.01" y2="16"/></svg>
}
function IconSettings() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
}
function IconPlus() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
}
function IconSparkle() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 17l-6.2 4.3 2.4-7.4L2 9.4h7.6z"/></svg>
}

/* ─── Навигация ───────────────────────────────────────────────────────────── */

interface NavItem {
  href: string
  label: string
  icon: React.ReactNode
}

const navGroups = [
  {
    title: 'Рабочая область',
    items: [
      { href: '/', label: 'Главная', icon: <IconHome /> },
      { href: '/counterparties', label: 'Контрагенты', icon: <IconUsers /> },
      { href: '/documents', label: 'Документы', icon: <IconFiles /> },
      { href: '/history', label: 'История версий', icon: <IconClock /> },
    ],
  },
  {
    title: 'Финансы',
    items: [
      { href: '/balance', label: 'Баланс', icon: <IconWallet /> },
      { href: '/payments', label: 'История платежей', icon: <IconReceipt /> },
      { href: '/storage', label: 'Хранилище', icon: <IconHardDrive /> },
    ],
  },
  {
    title: 'Настройки',
    items: [
      { href: '/requisites', label: 'Мои реквизиты', icon: <IconSettings /> },
    ],
  },
]

function NavLink({ href, label, icon }: NavItem) {
  const pathname = usePathname()
  const isActive = pathname === href || (href !== '/' && pathname.startsWith(href))

  return (
    <Link
      href={href}
      className={[
        'flex items-center gap-[10px] h-[34px] px-[10px] rounded-[var(--radius-md)]',
        'text-[13px] font-medium transition-colors duration-[120ms] no-underline',
        isActive
          ? 'bg-[var(--surface-inset)] text-[var(--ink)]'
          : 'text-[var(--ink-3)] hover:text-[var(--ink-2)] hover:bg-[var(--surface-inset)]',
        '[&_svg]:shrink-0',
      ].join(' ')}
    >
      {icon}
      {label}
    </Link>
  )
}

/* ─── Sidebar ─────────────────────────────────────────────────────────────── */

function Sidebar() {
  return (
    <aside className="w-[232px] shrink-0 flex flex-col bg-[var(--bg-soft)] border-r border-[var(--line)] h-screen sticky top-0">
      {/* Логотип */}
      <div className="h-[56px] flex items-center px-[20px] border-b border-[var(--line)]">
        <span className="font-[var(--font-display)] text-[18px] font-semibold text-[var(--ink)] tracking-[-0.02em]">
          Договора
        </span>
      </div>

      {/* Кнопка «Новый документ» */}
      <div className="px-[12px] pt-[16px] pb-[8px]">
        <Link
          href="/documents/new"
          className={[
            'flex items-center justify-center gap-[8px] w-full h-[36px] rounded-[var(--radius-md)]',
            'bg-[var(--ink)] text-white text-[14px] font-medium',
            'hover:bg-black transition-colors duration-[120ms] no-underline',
          ].join(' ')}
        >
          <IconPlus />
          Новый документ
        </Link>
      </div>

      {/* Навигация */}
      <nav className="flex-1 overflow-y-auto px-[12px] pb-[12px] flex flex-col gap-[20px] pt-[8px]">
        {navGroups.map((group) => (
          <div key={group.title}>
            <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.12em] px-[10px] mb-[4px]">
              {group.title}
            </p>
            <div className="flex flex-col gap-[2px]">
              {group.items.map((item) => (
                <NavLink key={item.href} {...item} />
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Профиль внизу */}
      <div className="border-t border-[var(--line)] px-[12px] py-[12px]">
        <div className="flex items-center gap-[10px] px-[10px] py-[6px] rounded-[var(--radius-md)] hover:bg-[var(--surface-inset)] cursor-pointer transition-colors duration-[120ms]">
          <div
            className="w-[28px] h-[28px] rounded-full bg-[oklch(0.88_0.04_260)] flex items-center justify-center text-[11px] font-semibold text-[var(--accent-ink)] border border-[var(--line)] shrink-0"
          >
            П
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium text-[var(--ink)] truncate">Мой профиль</p>
            <p className="text-[11px] text-[var(--ink-4)] truncate">Настройки аккаунта</p>
          </div>
        </div>
      </div>
    </aside>
  )
}

/* ─── Topbar ──────────────────────────────────────────────────────────────── */

interface TopbarProps {
  breadcrumbs?: { label: string; href?: string }[]
  actions?: React.ReactNode
  balance?: number
}

function Topbar({ breadcrumbs = [], actions, balance }: TopbarProps) {
  return (
    <header className="h-[56px] shrink-0 flex items-center justify-between px-[24px] border-b border-[var(--line)] bg-[var(--bg)] sticky top-0 z-10">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-[6px] text-[13px]">
        {breadcrumbs.map((crumb, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="text-[var(--ink-5)]">/</span>}
            {crumb.href ? (
              <Link href={crumb.href} className="text-[var(--ink-3)] hover:text-[var(--ink-2)] no-underline transition-colors">
                {crumb.label}
              </Link>
            ) : (
              <span className="text-[var(--ink)] font-medium">{crumb.label}</span>
            )}
          </React.Fragment>
        ))}
      </nav>

      {/* Правая часть */}
      <div className="flex items-center gap-[12px]">
        {actions}
        {/* Баланс */}
        {balance !== undefined && (
          <div className="flex items-center gap-[6px] bg-[var(--surface)] border border-[var(--line-2)] rounded-[var(--radius-md)] px-[10px] h-[32px]">
            <IconWallet />
            <span className="font-[var(--font-mono)] text-[13px] font-medium text-[var(--ink)] tabular-nums">
              {balance.toLocaleString('ru')} ₽
            </span>
          </div>
        )}
      </div>
    </header>
  )
}

/* ─── AppLayout ───────────────────────────────────────────────────────────── */

interface AppLayoutProps {
  children: React.ReactNode
  breadcrumbs?: { label: string; href?: string }[]
  actions?: React.ReactNode
  balance?: number
}

export function AppLayout({ children, breadcrumbs, actions, balance = 0 }: AppLayoutProps) {
  return (
    <div className="flex h-screen bg-[var(--bg)] overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Topbar breadcrumbs={breadcrumbs} actions={actions} balance={balance} />
        <main className="flex-1 overflow-y-auto p-[24px]">
          {children}
        </main>
      </div>
    </div>
  )
}
