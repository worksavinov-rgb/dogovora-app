import { Card } from '@/components/ui/card'

export default function HomePage() {
  return (
    <div className="max-w-[1080px]">
      {/* Приветствие */}
      <div style={{ marginBottom: 28 }}>
        <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.12em] mb-[8px]">
          Понедельник, 18 мая
        </p>
        <h1 style={{ fontSize: 30, marginBottom: 6 }}>Добро пожаловать.</h1>
        <p className="text-[15px] text-[var(--ink-3)]">
          Начните с создания нового договора или загрузите существующий для проверки.
        </p>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-4 gap-[12px]" style={{ marginBottom: 28 }}>
        {[
          { label: 'Создать договор', sub: 'С нуля или из шаблона', href: '/documents/new' },
          { label: 'Проверить документ', sub: 'Загрузить и оценить риски', href: '/documents/new?mode=check' },
          { label: 'Сравнить версии', sub: 'Найти отличия двух файлов', href: '/documents' },
          { label: 'Пополнить баланс', sub: 'Управление средствами', href: '/balance' },
        ].map((a) => (
          <a key={a.label} href={a.href} className="no-underline">
            <Card className="cursor-pointer hover:border-[var(--line-strong)] transition-colors duration-[120ms] h-full">
              <div
                className="inline-flex items-center justify-center rounded-[var(--radius-md)] bg-[var(--surface-inset)]"
                style={{ width: 32, height: 32, marginBottom: 12 }}
              >
                <span className="text-[var(--ink-3)] text-[16px]">+</span>
              </div>
              <p className="text-[14px] font-medium text-[var(--ink)]" style={{ marginBottom: 2 }}>{a.label}</p>
              <p className="text-[12px] text-[var(--ink-3)]">{a.sub}</p>
            </Card>
          </a>
        ))}
      </div>

      {/* Две колонки */}
      <div className="grid grid-cols-[2fr_1fr] gap-[16px]">
        {/* Недавние документы */}
        <Card pad={false}>
          <div className="flex items-center justify-between px-[20px] py-[16px] border-b border-[var(--line)]">
            <p className="text-[14px] font-medium text-[var(--ink)]">Недавние документы</p>
            <a href="/documents" className="text-[13px] text-[var(--accent)] no-underline hover:text-[var(--accent-hover)]">
              Все документы →
            </a>
          </div>
          <div className="px-[20px] py-[40px] text-center">
            <p className="text-[13px] text-[var(--ink-4)]">Документы появятся здесь после создания</p>
          </div>
        </Card>

        {/* Правая колонка */}
        <div className="flex flex-col gap-[12px]">
          <Card>
            <p className="text-[12px] text-[var(--ink-4)] uppercase tracking-[0.1em] font-medium mb-[8px]">Баланс</p>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: 32, fontWeight: 400, marginBottom: 4 }}>
              0 ₽
            </p>
            <a href="/balance" className="text-[13px] text-[var(--accent)] no-underline">
              Пополнить →
            </a>
          </Card>

          <Card>
            <p className="text-[12px] text-[var(--ink-4)] uppercase tracking-[0.1em] font-medium mb-[8px]">Хранилище</p>
            <div className="flex items-center justify-between mb-[8px]">
              <p className="text-[13px] text-[var(--ink)]">0 МБ из 500 МБ</p>
              <p className="text-[12px] text-[var(--ink-4)]">0%</p>
            </div>
            <div className="h-[4px] bg-[var(--line)] rounded-full">
              <div className="h-full bg-[var(--ink)] rounded-full" style={{ width: '0%' }} />
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
