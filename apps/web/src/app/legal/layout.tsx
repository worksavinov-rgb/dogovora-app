import Link from 'next/link'
import { LEGAL_DOCUMENTS } from '@/lib/legal'

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--bg)] flex flex-col">
      {/* Шапка */}
      <header className="border-b border-[var(--line)] bg-[var(--surface)]">
        <div className="max-w-[760px] mx-auto px-[24px] h-[60px] flex items-center justify-between">
          <Link
            href="/"
            className="font-[var(--font-display)] text-[17px] font-semibold text-[var(--ink)] tracking-[-0.02em] no-underline"
          >
            Догодок
          </Link>
          <Link
            href="/login"
            className="text-[13px] text-[var(--ink-3)] hover:text-[var(--ink)] no-underline transition-colors duration-[120ms]"
          >
            Вход в сервис
          </Link>
        </div>
      </header>

      {/* Документ */}
      <main className="flex-1 w-full max-w-[760px] mx-auto px-[24px] py-[48px]">{children}</main>

      {/* Подвал со всеми документами */}
      <footer className="border-t border-[var(--line)] mt-[24px]">
        <div className="max-w-[760px] mx-auto px-[24px] py-[28px] flex flex-wrap gap-x-[22px] gap-y-[10px]">
          {LEGAL_DOCUMENTS.map((d) => (
            <Link
              key={d.slug}
              href={`/legal/${d.slug}`}
              className="text-[12.5px] text-[var(--ink-4)] hover:text-[var(--ink-2)] no-underline transition-colors duration-[120ms]"
            >
              {d.shortTitle}
            </Link>
          ))}
          <Link
            href="/support"
            className="text-[12.5px] text-[var(--ink-4)] hover:text-[var(--ink-2)] no-underline transition-colors duration-[120ms]"
          >
            Поддержка
          </Link>
        </div>
      </footer>
    </div>
  )
}
