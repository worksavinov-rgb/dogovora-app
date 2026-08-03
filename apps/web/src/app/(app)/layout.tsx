'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AppLayout } from '@/components/layout/app-layout'
import { ConsentGate } from '@/components/legal/consent-gate'
import { useAuthStore } from '@/store/auth'
import { useTopbarStore } from '@/store/topbar'
import { installFetchAuthRetry } from '@/lib/install-fetch-auth'

export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { user, balance, isInitialized, initialize, needsConsent } = useAuthStore()
  const pageTitle = useTopbarStore((s) => s.pageTitle)

  // Глобально включаем авто-обновление сессии при 401 для всех страниц за логином:
  // истёкший 15-мин токен больше не роняет запросы (админка, баланс, сохранения и т.д.).
  useEffect(() => {
    installFetchAuthRetry()
  }, [])

  useEffect(() => {
    initialize()
  }, [initialize])

  useEffect(() => {
    if (isInitialized && !user) {
      router.push('/login')
    }
  }, [isInitialized, user, router])

  if (!isInitialized) {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-[var(--line-strong)] border-t-[var(--ink)] rounded-full animate-spin" />
          <p className="text-[13px] text-[var(--ink-4)]">Загрузка...</p>
        </div>
      </div>
    )
  }

  if (!user) return null

  const breadcrumbs = pageTitle ? [{ label: pageTitle }] : undefined
  return (
    <AppLayout balance={balance} breadcrumbs={breadcrumbs}>
      {children}
      {/* Аккаунты, созданные до введения согласий, и выход новой редакции документов */}
      {needsConsent && <ConsentGate />}
    </AppLayout>
  )
}
