import Link from 'next/link'
import type { Metadata } from 'next'
import { LEGAL_DOCUMENTS } from '@/lib/legal'

export const metadata: Metadata = {
  title: 'Юридические документы — Догодок',
  description: 'Оферта, политика обработки персональных данных и согласия сервиса «Догодок».',
}

export default function LegalIndexPage() {
  return (
    <div>
      <h1 className="text-[28px] leading-[1.2] font-[var(--font-display)] font-normal text-[var(--ink)] mb-[10px]">
        Юридические документы
      </h1>
      <p className="text-[14px] text-[var(--ink-3)] leading-[1.6] mb-[32px]">
        Условия работы сервиса «Догодок», порядок обработки персональных данных и тексты согласий,
        которые вы принимаете при создании аккаунта.
      </p>

      <div className="flex flex-col gap-[10px]">
        {LEGAL_DOCUMENTS.map((doc) => (
          <Link
            key={doc.slug}
            href={`/legal/${doc.slug}`}
            className="block no-underline rounded-[var(--radius-lg)] px-[20px] py-[17px] transition-[border-color,box-shadow] duration-[120ms] hover:shadow-[var(--shadow-1)]"
            style={{ background: 'var(--surface)', border: '1px solid var(--line-2)' }}
          >
            <div className="text-[15px] text-[var(--ink)] mb-[5px]">{doc.title}</div>
            <div className="text-[13px] text-[var(--ink-3)] leading-[1.55]">{doc.subtitle}</div>
            <div className="font-[var(--font-mono)] text-[11px] text-[var(--ink-4)] mt-[9px]">
              Редакция от {doc.versionLabel}
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
