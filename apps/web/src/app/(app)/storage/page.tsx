import { Card } from '@/components/ui/card'

export default function StoragePage() {
  return (
    <div className="max-w-[1080px]">
      <div className="mb-[24px]">
        <h2 style={{ fontSize: 24, marginBottom: 4 }}>Хранилище и тарифы</h2>
        <p className="text-[14px] text-[var(--ink-3)]">Управление хранилищем файлов и тарифным планом</p>
      </div>

      <div className="grid grid-cols-[1fr_320px] gap-[16px] mb-[24px]">
        <Card>
          <p className="text-[13px] font-medium text-[var(--ink)] mb-[16px]">Использование хранилища</p>
          <div className="flex items-center justify-between mb-[8px]">
            <p className="text-[13px] text-[var(--ink-2)]">0 МБ из 500 МБ</p>
            <p className="text-[12px] text-[var(--ink-4)]">0%</p>
          </div>
          <div className="h-[6px] bg-[var(--line)] rounded-full mb-[20px]">
            <div className="h-full bg-[var(--ink)] rounded-full" style={{ width: '0%' }} />
          </div>
          <div className="grid grid-cols-4 gap-[12px]">
            {[
              { label: 'Документы', value: '0 МБ', color: '#18181B' },
              { label: 'Версии', value: '0 МБ', color: '#6B6962' },
              { label: 'Отчёты ИИ', value: '0 МБ', color: '#A09D94' },
              { label: 'Прикреплённые', value: '0 МБ', color: '#C8C5BC' },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-[8px]">
                <div className="w-[8px] h-[8px] rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                <div>
                  <p className="text-[12px] text-[var(--ink-3)]">{item.label}</p>
                  <p className="text-[12px] font-medium text-[var(--ink)]" style={{ fontFamily: 'var(--font-mono)' }}>{item.value}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <p className="text-[12px] text-[var(--ink-4)] uppercase tracking-[0.1em] font-medium mb-[8px]">Тарифный план</p>
          <p className="text-[16px] font-medium text-[var(--ink)] mb-[4px]">Старт</p>
          <p className="text-[13px] text-[var(--ink-3)]">500 МБ хранилища</p>
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-[12px]">
        {[
          { name: 'Старт', storage: '500 МБ', price: 'Бесплатно', current: true },
          { name: 'Дело', storage: '5 ГБ', price: '490 ₽/мес' },
          { name: 'Бюро', storage: '50 ГБ', price: '1 490 ₽/мес' },
        ].map((plan) => (
          <Card key={plan.name} className={plan.current ? 'border-[var(--ink)]' : ''}>
            {plan.current && (
              <p className="text-[11px] text-[var(--accent-ink)] bg-[var(--accent-soft)] rounded-[var(--radius-xs)] px-[6px] py-[2px] inline-block mb-[12px] font-medium uppercase tracking-[0.08em]">
                Текущий
              </p>
            )}
            <p className="text-[16px] font-medium text-[var(--ink)] mb-[4px]">{plan.name}</p>
            <p className="text-[13px] text-[var(--ink-3)] mb-[16px]">{plan.storage}</p>
            <p style={{ fontFamily: 'var(--font-display)', fontSize: 20, fontWeight: 500, marginBottom: 16 }}>
              {plan.price}
            </p>
            {!plan.current && (
              <button className="w-full h-[36px] rounded-[var(--radius-md)] border border-[var(--line-2)] text-[14px] font-medium text-[var(--ink)] bg-[var(--surface)] hover:border-[var(--line-strong)] cursor-pointer transition-colors">
                Перейти
              </button>
            )}
          </Card>
        ))}
      </div>
    </div>
  )
}
