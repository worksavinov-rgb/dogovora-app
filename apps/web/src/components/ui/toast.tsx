'use client'

import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react'

// ─── Типы ─────────────────────────────────────────────────────────────────────

export type ToastType = 'success' | 'error' | 'info'

export interface Toast {
  id: string
  message: string
  type: ToastType
}

interface ToastContextValue {
  toasts: Toast[]
  toast: (message: string, type?: ToastType) => void
  dismiss: (id: string) => void
}

// ─── Context ──────────────────────────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Math.random().toString(36).slice(2)
    setToasts((prev) => [...prev, { id, message, type }])
    setTimeout(() => dismiss(id), 4000)
  }, [dismiss])

  return (
    <ToastContext.Provider value={{ toasts, toast, dismiss }}>
      {children}
      <ToastContainer toasts={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}

// ─── ToastContainer ───────────────────────────────────────────────────────────

function ToastContainer({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: string) => void }) {
  if (toasts.length === 0) return null

  return (
    <div
      className="fixed bottom-[24px] right-[24px] flex flex-col gap-[8px] z-[9999]"
      style={{ pointerEvents: 'none' }}
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} dismiss={dismiss} />
      ))}
    </div>
  )
}

const TYPE_STYLES: Record<ToastType, { border: string; icon: string; color: string }> = {
  success: { border: 'oklch(0.75 0.1 145)', icon: '✓', color: 'oklch(0.45 0.1 145)' },
  error:   { border: 'var(--danger)',        icon: '✕', color: 'var(--danger)' },
  info:    { border: 'var(--line)',          icon: '·', color: 'var(--ink-3)' },
}

function ToastItem({ toast, dismiss }: { toast: Toast; dismiss: (id: string) => void }) {
  const style = TYPE_STYLES[toast.type]
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    // Slide in
    el.animate([
      { opacity: 0, transform: 'translateX(16px)' },
      { opacity: 1, transform: 'translateX(0)' },
    ], { duration: 200, easing: 'ease-out', fill: 'forwards' })
  }, [])

  return (
    <div
      ref={ref}
      onClick={() => dismiss(toast.id)}
      className="flex items-center gap-[10px] px-[14px] py-[10px] rounded-[var(--radius-md)] cursor-pointer"
      style={{
        background: 'var(--bg)',
        border: `1px solid ${style.border}`,
        boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
        pointerEvents: 'auto',
        minWidth: 240,
        maxWidth: 360,
      }}
    >
      <span className="text-[13px] font-bold shrink-0" style={{ color: style.color }}>
        {style.icon}
      </span>
      <p className="text-[13px] text-[var(--ink)] flex-1">{toast.message}</p>
    </div>
  )
}
