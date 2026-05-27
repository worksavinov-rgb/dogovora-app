'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { AppLayout } from '@/components/layout/app-layout'
import { useAuthStore } from '@/store/auth'

export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const { user, balance, isInitialized, initialize } = useAuthStore()

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

  return <AppLayout balance={balance}>{children}</AppLayout>
}
