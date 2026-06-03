'use client'

import { useState, useEffect, useRef } from 'react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

// ─── Типы ─────────────────────────────────────────────────────────────────────

interface Template {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

// ─── mammoth для парсинга DOCX ────────────────────────────────────────────────

async function parseDocxToText(file: File): Promise<string> {
  const mammoth = await import('mammoth')
  const arrayBuffer = await file.arrayBuffer()
  const result = await mammoth.convertToHtml({ arrayBuffer })
  return result.value
}

// ─── Диалог переименования ────────────────────────────────────────────────────

function RenameDialog({ template, onSave, onClose }: {
  template: Template
  onSave: (name: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState(template.name)
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }}
      onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-[var(--radius-xl)] shadow-xl w-[360px] p-[24px]">
        <p className="text-[13px] font-medium text-[var(--ink)] mb-[12px]">Переименовать шаблон</p>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
          onKeyDown={(e) => { if (e.key === 'Enter') onSave(name) }}
          className="w-full h-[38px] px-[12px] text-[14px] bg-[var(--surface)] border border-[var(--line-2)] rounded-[var(--radius-md)] outline-none focus:border-[var(--accent)] transition-colors"
        />
        <div className="flex gap-[8px] mt-[14px]">
          <button onClick={onClose}
            className="flex-1 h-[36px] rounded-[var(--radius-md)] text-[13px] bg-[var(--surface-inset)] text-[var(--ink-2)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer">
            Отмена
          </button>
          <button onClick={() => onSave(name)} disabled={!name.trim()}
            className="flex-1 h-[36px] rounded-[var(--radius-md)] text-[13px] font-medium bg-[var(--ink)] text-[var(--bg)] hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-40">
            Сохранить
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Карточка шаблона ─────────────────────────────────────────────────────────

function TemplateCard({ template, onRename, onDelete, onUse }: {
  template: Template
  onRename: () => void
  onDelete: () => void
  onUse: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [menuOpen])

  const relDate = (iso: string) => {
    const d = new Date(iso)
    const diff = Math.floor((Date.now() - d.getTime()) / 86400000)
    if (diff === 0) return 'сегодня'
    if (diff === 1) return 'вчера'
    return d.toLocaleDateString('ru', { day: 'numeric', month: 'short' })
  }

  return (
    <div className="flex items-center gap-[12px] rounded-[var(--radius-md)] px-[16px] py-[14px] group transition-colors"
      style={{ background: 'white', border: '1px solid var(--line)', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
      {/* Иконка */}
      <div className="shrink-0 w-[36px] h-[36px] rounded-[var(--radius-md)] flex items-center justify-center"
        style={{ background: 'var(--surface-inset)' }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink-4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
        </svg>
      </div>

      {/* Название и дата */}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-medium text-[var(--ink)] truncate">{template.name}</p>
        <p className="text-[11px] text-[var(--ink-4)] mt-[1px]">Обновлён {relDate(template.updatedAt)}</p>
      </div>

      {/* Использовать */}
      <button
        onClick={onUse}
        className="h-[30px] px-[12px] text-[12px] font-medium bg-[var(--ink)] text-[var(--bg)] rounded-[var(--radius-md)] hover:opacity-90 transition-opacity cursor-pointer opacity-0 group-hover:opacity-100"
      >
        Использовать
      </button>

      {/* Меню */}
      <div ref={menuRef} className="relative">
        <button
          onClick={() => setMenuOpen((v) => !v)}
          className="w-[28px] h-[28px] flex items-center justify-center rounded-[var(--radius-sm)] text-[var(--ink-4)] hover:text-[var(--ink)] hover:bg-[var(--surface-2)] transition-colors cursor-pointer"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>
          </svg>
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-[32px] z-50 rounded-[var(--radius-md)] py-[4px] min-w-[160px]"
            style={{ background: 'white', border: '1px solid var(--line)', boxShadow: '0 4px 16px rgba(0,0,0,0.1)' }}>
            <button className="w-full text-left px-[14px] py-[8px] text-[13px] text-[var(--ink)] hover:bg-[var(--surface-inset)] cursor-pointer"
              onClick={() => { onRename(); setMenuOpen(false) }}>Переименовать</button>
            <div className="mx-[8px] my-[4px] h-px bg-[var(--line)]" />
            <button className="w-full text-left px-[14px] py-[8px] text-[13px] text-[var(--danger)] hover:bg-[var(--surface-inset)] cursor-pointer"
              onClick={() => { onDelete(); setMenuOpen(false) }}>Удалить</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Главная страница ─────────────────────────────────────────────────────────

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const load = async () => {
    const res = await fetch('/api/templates')
    if (res.ok) setTemplates(await res.json())
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  async function handleUpload(file: File) {
    setUploading(true)
    try {
      let content = ''
      if (file.name.endsWith('.docx') || file.name.endsWith('.doc')) {
        content = await parseDocxToText(file)
      } else {
        content = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = (e) => resolve(e.target?.result as string)
          reader.onerror = reject
          reader.readAsText(file, 'utf-8')
        })
      }

      const name = file.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ')
      const res = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, content }),
      })
      if (res.ok) await load()
    } finally {
      setUploading(false)
    }
  }

  async function handleRename(id: string, name: string) {
    await fetch(`/api/templates/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    setRenamingId(null)
    await load()
  }

  function handleDelete(id: string) {
    setDeleteConfirmId(id)
  }

  async function confirmDelete() {
    if (!deleteConfirmId) return
    await fetch(`/api/templates/${deleteConfirmId}`, { method: 'DELETE' })
    setTemplates((prev) => prev.filter((t) => t.id !== deleteConfirmId))
    setDeleteConfirmId(null)
  }

  function handleUse(template: Template) {
    // Переходим на создание документа с выбранным шаблоном
    window.location.href = `/documents/new?templateId=${template.id}`
  }

  const renamingTemplate = templates.find((t) => t.id === renamingId)

  return (
    <>
      <ConfirmDialog
        open={!!deleteConfirmId}
        title="Удалить шаблон?"
        message="Шаблон будет удалён безвозвратно. Это действие нельзя отменить."
        confirmLabel="Удалить"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteConfirmId(null)}
      />
      {renamingTemplate && (
        <RenameDialog
          template={renamingTemplate}
          onSave={(name) => handleRename(renamingTemplate.id, name)}
          onClose={() => setRenamingId(null)}
        />
      )}

      <div className="max-w-[860px]">
        {/* Заголовок */}
        <div className="mb-[24px]">
          <p className="text-[12px] text-[var(--ink-4)] mb-[4px]">{templates.length} шаблонов</p>
          <div className="flex items-start justify-between gap-[12px]">
            <div>
              <h2 style={{ fontFamily: 'var(--font-display)', fontSize: 28, fontWeight: 400 }}>Мои шаблоны</h2>
              <p className="text-[13px] text-[var(--ink-3)] mt-[4px]">
                Загрузите любой договор как шаблон и используйте его основу при создании новых документов.
              </p>
            </div>
            <div className="flex items-center gap-[8px] shrink-0">
              <input ref={fileInputRef} type="file" accept=".docx,.doc,.txt" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) handleUpload(f) }} />
              <Button
                variant="primary"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {uploading ? 'Загружаю…' : '↑ Загрузить шаблон'}
              </Button>
            </div>
          </div>
        </div>

        {/* Подсказка */}
        <div className="flex items-start gap-[12px] rounded-[var(--radius-md)] px-[16px] py-[12px] mb-[20px]"
          style={{ background: 'oklch(0.97 0.015 260)', border: '1px solid oklch(0.9 0.02 260)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="oklch(0.42 0.06 260)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-[1px]">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <p className="text-[12px] leading-[1.5]" style={{ color: 'oklch(0.42 0.06 260)' }}>
            Шаблоны — только ваши, не публичные. Загруженный файл становится отправной точкой при создании документа — ИИ доработает его под конкретного контрагента.
          </p>
        </div>

        {/* Список */}
        {loading ? (
          <div className="flex flex-col gap-[8px]">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-[12px] rounded-[var(--radius-md)] px-[16px] py-[14px]"
                style={{ background: 'white', border: '1px solid var(--line)' }}>
                <Skeleton className="w-[36px] h-[36px] shrink-0" />
                <div className="flex-1 flex flex-col gap-[6px]">
                  <Skeleton className="h-[13px] w-[40%]" />
                  <Skeleton className="h-[10px] w-[20%]" />
                </div>
              </div>
            ))}
          </div>
        ) : templates.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center gap-[12px] rounded-[var(--radius-lg)] border-2 border-dashed cursor-pointer"
            style={{ border: '2px dashed var(--line-2)', padding: '64px 40px' }}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) handleUpload(f) }}
          >
            <div className="w-[48px] h-[48px] rounded-full bg-[var(--surface-inset)] flex items-center justify-center">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--ink-4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
            </div>
            <p className="text-[15px] text-[var(--ink-3)]" style={{ fontFamily: 'var(--font-serif)' }}>
              Шаблонов пока нет
            </p>
            <p className="text-[12px] text-[var(--ink-4)]">Нажмите или перетащите файл DOCX/TXT</p>
          </div>
        ) : (
          <div className="flex flex-col gap-[8px]">
            {templates.map((t) => (
              <TemplateCard
                key={t.id}
                template={t}
                onRename={() => setRenamingId(t.id)}
                onDelete={() => handleDelete(t.id)}
                onUse={() => handleUse(t)}
              />
            ))}
          </div>
        )}
      </div>
    </>
  )
}
