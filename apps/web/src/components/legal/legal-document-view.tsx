import * as React from 'react'
import Link from 'next/link'
import type { LegalBlock, LegalDocument } from '@/lib/legal/types'

/* ─── Инлайн-разметка ────────────────────────────────────────────────────────
   Поддерживаем ровно два элемента: **жирный** и [текст](ссылка).
   Парсим вручную, без dangerouslySetInnerHTML.
   ────────────────────────────────────────────────────────────────────────── */

const INLINE_RE = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)]+)\)/g

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  let i = 0

  INLINE_RE.lastIndex = 0
  while ((match = INLINE_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index))
    }

    const [, bold, linkText, href] = match

    if (bold !== undefined) {
      nodes.push(
        <strong key={`${keyPrefix}-b${i}`} className="font-semibold text-[var(--ink)]">
          {bold}
        </strong>,
      )
    } else if (linkText !== undefined && href !== undefined) {
      const external = href.startsWith('http') || href.startsWith('mailto:')
      nodes.push(
        external ? (
          <a
            key={`${keyPrefix}-a${i}`}
            href={href}
            target={href.startsWith('mailto:') ? undefined : '_blank'}
            rel="noopener noreferrer"
            className="text-[var(--accent)] hover:text-[var(--accent-hover)] underline underline-offset-2"
          >
            {linkText}
          </a>
        ) : (
          <Link
            key={`${keyPrefix}-a${i}`}
            href={href}
            className="text-[var(--accent)] hover:text-[var(--accent-hover)] underline underline-offset-2"
          >
            {linkText}
          </Link>
        ),
      )
    }

    lastIndex = match.index + match[0].length
    i++
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
}

/* ─── Блоки ──────────────────────────────────────────────────────────────── */

function Block({ block, index }: { block: LegalBlock; index: number }) {
  const key = `b${index}`

  switch (block.t) {
    case 'h2':
      return (
        <h2
          className="text-[18px] font-[var(--font-display)] font-normal text-[var(--ink)] mt-[36px] mb-[12px] first:mt-0 scroll-mt-[80px]"
          id={`p-${index}`}
        >
          {block.text}
        </h2>
      )

    case 'h3':
      return (
        <h3 className="text-[14px] font-semibold text-[var(--ink)] mt-[24px] mb-[8px]">
          {block.text}
        </h3>
      )

    case 'p':
      return (
        <p className="text-[14px] leading-[1.65] text-[var(--ink-2)] mb-[12px]">
          {renderInline(block.text, key)}
        </p>
      )

    case 'ul':
      return (
        <ul className="mb-[14px] flex flex-col gap-[7px] pl-[2px]">
          {block.items.map((item, i) => (
            <li
              key={i}
              className="text-[14px] leading-[1.6] text-[var(--ink-2)] pl-[18px] relative"
            >
              <span className="absolute left-[4px] top-[9px] w-[4px] h-[4px] rounded-full bg-[var(--ink-4)]" />
              {renderInline(item, `${key}-${i}`)}
            </li>
          ))}
        </ul>
      )

    case 'note':
      return (
        <div
          className="my-[18px] px-[16px] py-[13px] rounded-[var(--radius-md)] text-[13px] leading-[1.6] text-[var(--ink-2)]"
          style={{ background: 'var(--accent-soft)', borderLeft: '2px solid var(--accent)' }}
        >
          {renderInline(block.text, key)}
        </div>
      )

    case 'req':
      return (
        <div
          className="my-[18px] px-[16px] py-[14px] rounded-[var(--radius-md)] flex flex-col gap-[5px]"
          style={{ background: 'var(--surface-inset)', border: '1px solid var(--line)' }}
        >
          {block.items.map((item, i) => (
            <div
              key={i}
              className="font-[var(--font-mono)] text-[12.5px] leading-[1.55] text-[var(--ink-2)]"
            >
              {item}
            </div>
          ))}
        </div>
      )
  }
}

/* ─── Документ целиком ───────────────────────────────────────────────────── */

export function LegalDocumentView({ doc }: { doc: LegalDocument }) {
  return (
    <article>
      <div className="mb-[32px] pb-[24px] border-b border-[var(--line)]">
        <div className="text-[11px] uppercase tracking-[0.08em] text-[var(--ink-4)] mb-[10px]">
          Юридический документ
        </div>
        <h1 className="text-[28px] leading-[1.2] font-[var(--font-display)] font-normal text-[var(--ink)] mb-[10px]">
          {doc.title}
        </h1>
        <p className="text-[14px] text-[var(--ink-3)] leading-[1.6]">{doc.subtitle}</p>
        <p className="font-[var(--font-mono)] text-[12px] text-[var(--ink-4)] mt-[14px]">
          Редакция от {doc.versionLabel} · версия {doc.version}
        </p>
      </div>

      {doc.blocks.map((block, i) => (
        <Block key={i} block={block} index={i} />
      ))}
    </article>
  )
}
