'use client'

import { useRef, useState } from 'react'
import type { ParsedRequisites } from '@/lib/requisites-parser'

interface Props {
  onManual: () => void
  onParsed: (fields: ParsedRequisites, fileName: string) => void
  onClose: () => void
}

/**
 * Окно выбора способа добавления контрагента. Открывается по «+ Новый контрагент».
 *
 * Обе дороги ведут на одну и ту же страницу формы: разница только в том, приходит
 * она пустой или уже заполненной из файла. Второй формы не появляется — иначе их
 * пришлось бы поддерживать парой и они бы разъехались.
 */
export function AddCounterpartyModal({ onManual, onParsed, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleFile = async (file: File) => {
    setBusy(true)
    setError(null)
    try {
      const body = new FormData()
      body.append('file', file)
      const res = await fetch('/api/counterparties/parse-requisites', { method: 'POST', body })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error ?? 'Не удалось прочитать файл')
        return
      }
      onParsed(data.fields as ParsedRequisites, data.fileName as string)
    } catch {
      setError('Не удалось связаться с сервером. Проверьте соединение и попробуйте снова.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 backdrop-blur-[2px] px-[16px]"
      onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}
    >
      <div className="relative w-full max-w-[480px] bg-[var(--surface)] rounded-[var(--radius-md)] shadow-xl overflow-hidden">
        <div className="flex items-start gap-[12px] px-[24px] pt-[22px] pb-[16px] border-b border-[var(--line)]">
          <div className="flex-1 min-w-0">
            <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 400 }}>
              Как добавить контрагента?
            </h3>
            <p className="text-[13px] text-[var(--ink-3)] mt-[4px]">
              Если контрагент прислал карточку реквизитов — не перебивайте её руками.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={busy}
            aria-label="Закрыть"
            className="w-[28px] h-[28px] flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--ink-4)] hover:text-[var(--ink)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer disabled:opacity-40"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="p-[16px] flex flex-col gap-[10px]">
          <button
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="text-left flex items-start gap-[12px] p-[14px] rounded-[var(--radius-md)] border border-[var(--line)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)] transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-wait"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mt-[2px] shrink-0">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M12 18v-6" /><path d="m9 15 3-3 3 3" />
            </svg>
            <span className="min-w-0">
              <span className="block text-[14px] font-medium text-[var(--ink)]">
                {busy ? 'Читаем файл…' : 'Загрузить файл с реквизитами'}
              </span>
              <span className="block text-[12px] text-[var(--ink-3)] mt-[2px]">
                Word или PDF. Распознаем ИНН, ОГРН, адрес и банковские реквизиты — вы проверите и дополните.
              </span>
            </span>
          </button>

          <button
            onClick={onManual}
            disabled={busy}
            className="text-left flex items-start gap-[12px] p-[14px] rounded-[var(--radius-md)] border border-[var(--line)] hover:border-[var(--ink-4)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer disabled:opacity-60"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="mt-[2px] shrink-0">
              <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
            </svg>
            <span className="min-w-0">
              <span className="block text-[14px] font-medium text-[var(--ink)]">Заполнить вручную</span>
              <span className="block text-[12px] text-[var(--ink-3)] mt-[2px]">Откроется пустая форма.</span>
            </span>
          </button>

          {error && (
            <p className="text-[12px] text-[var(--danger)] bg-[var(--danger-soft)] rounded-[var(--radius-sm)] px-[12px] py-[10px]">
              {error}
            </p>
          )}

          <p className="text-[11px] text-[var(--ink-4)] px-[2px]">
            Файл читается на нашем сервере и нигде не сохраняется. В ИИ он не передаётся.
          </p>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept=".docx,.pdf,.txt"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) void handleFile(f)
          }}
        />
      </div>
    </div>
  )
}
