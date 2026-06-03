'use client'

import { useEffect, useRef } from 'react'

interface ConfirmDialogProps {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Удалить',
  cancelLabel = 'Отмена',
  danger = true,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open) confirmRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/30 backdrop-blur-[2px]"
        onClick={onCancel}
      />
      {/* Dialog */}
      <div
        className="relative z-10 w-[340px] rounded-[var(--radius-xl)] p-[24px] flex flex-col gap-[16px]"
        style={{ background: 'var(--bg)', border: '1px solid var(--line)', boxShadow: '0 16px 40px rgba(0,0,0,0.14)' }}
      >
        <div>
          <p className="text-[15px] font-semibold text-[var(--ink)] mb-[6px]">{title}</p>
          <p className="text-[13px] text-[var(--ink-3)] leading-[1.5]">{message}</p>
        </div>
        <div className="flex gap-[8px] justify-end">
          <button
            onClick={onCancel}
            className="h-[34px] px-[14px] rounded-[var(--radius-md)] text-[13px] font-medium text-[var(--ink-3)] bg-[var(--surface-inset)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            className="h-[34px] px-[14px] rounded-[var(--radius-md)] text-[13px] font-medium transition-colors cursor-pointer"
            style={danger
              ? { background: 'oklch(0.5 0.18 20)', color: 'white' }
              : { background: 'var(--ink)', color: 'var(--bg)' }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
