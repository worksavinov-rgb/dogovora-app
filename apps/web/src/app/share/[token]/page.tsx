'use client'

// Публичная страница «показать контрагенту»: read-only просмотр версии
// документа по непредсказуемой ссылке, без логина. Никаких действий,
// кроме чтения и печати, здесь нет.

import { useState, useEffect, use } from 'react'

interface SharedDoc {
  title: string
  number: string | null
  type: string
  versionNumber: number
  signingDate: string | null
  updatedAt: string
  content: string
}

const TYPE_LABELS: Record<string, string> = {
  CONTRACT: 'Договор', APPENDIX: 'Приложение', AMENDMENT: 'Доп. соглашение',
}

export default function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params)
  const [doc, setDoc] = useState<SharedDoc | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/share/${token}`)
      .then((r) => r.ok ? r.json() : r.json().then((e: { error?: string }) => Promise.reject(new Error(e.error ?? 'Ошибка'))))
      .then(setDoc)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-soft, #EDEAE4)' }}>
        <div className="w-[28px] h-[28px] border-2 border-[var(--line)] border-t-[var(--ink)] rounded-full animate-spin" />
      </div>
    )
  }

  if (error || !doc) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-[12px] px-[20px]" style={{ background: 'var(--bg, #FAF8F3)' }}>
        <p className="text-[20px]" style={{ fontFamily: 'var(--font-display)' }}>Догодок</p>
        <p className="text-[15px] font-medium text-[var(--ink)]">Документ недоступен</p>
        <p className="text-[13px] text-[var(--ink-4)] text-center max-w-[380px]">
          {error ?? 'Ссылка не найдена'}. Возможно, владелец отозвал доступ — запросите новую ссылку.
        </p>
      </div>
    )
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-soft, #EDEAE4)' }}>
      {/* Шапка */}
      <div
        className="sticky top-0 z-10 flex items-center justify-between px-[16px] md:px-[24px]"
        style={{ height: 52, background: 'var(--bg)', borderBottom: '1px solid var(--line)' }}
      >
        <div className="flex items-center gap-[10px] min-w-0">
          <p className="text-[16px] shrink-0" style={{ fontFamily: 'var(--font-display)' }}>Догодок</p>
          <span className="text-[var(--line-2)]">·</span>
          <p className="text-[13px] text-[var(--ink-2)] truncate">
            {doc.title}{doc.number ? ` № ${doc.number}` : ''}
          </p>
        </div>
        <button
          onClick={() => window.print()}
          className="shrink-0 h-[32px] px-[12px] rounded-[var(--radius-md)] text-[12px] font-medium text-[var(--ink-2)] bg-[var(--surface-inset)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer print:hidden"
        >
          Печать
        </button>
      </div>

      {/* Мета */}
      <div className="max-w-[860px] mx-auto px-[16px] md:px-[24px] pt-[20px] print:hidden">
        <p className="text-[12px] text-[var(--ink-4)]">
          {TYPE_LABELS[doc.type] ?? doc.type} · версия v.{doc.versionNumber} · только для ознакомления
        </p>
      </div>

      {/* Документ на «бумаге» */}
      <div className="max-w-[860px] mx-auto px-[8px] md:px-[24px] py-[16px] md:py-[24px]">
        {/* .doc-content — общие стили документного HTML из globals.css */}
        <div
          className="mx-auto bg-white rounded-[var(--radius-lg)] shadow-sm doc-content"
          style={{ maxWidth: 794, padding: '28px 24px', minHeight: 400, fontFamily: 'var(--font-serif)', fontSize: 14, lineHeight: 1.75 }}
          dangerouslySetInnerHTML={{ __html: doc.content }}
        />
      </div>

      {/* Подвал */}
      <div className="pb-[32px] text-center print:hidden">
        <p className="text-[11px] text-[var(--ink-4)]">
          Документ подготовлен в «Догодок» — сервисе работы с договорами
        </p>
      </div>
    </div>
  )
}
