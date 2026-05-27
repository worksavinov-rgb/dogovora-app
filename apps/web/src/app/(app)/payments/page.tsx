import { Card } from '@/components/ui/card'

export default function PaymentsPage() {
  return (
    <div className="max-w-[1080px]">
      <div className="mb-[24px]">
        <h2 style={{ fontSize: 24, marginBottom: 4 }}>История платежей</h2>
        <p className="text-[14px] text-[var(--ink-3)]">Пополнения и списания по вашему счёту</p>
      </div>

      <div className="grid grid-cols-4 gap-[12px] mb-[24px]">
        {[
          { label: 'Пополнено', value: '0 ₽', color: 'var(--ok)' },
          { label: 'Списано', value: '0 ₽', color: 'var(--ink)' },
          { label: 'Куплено версий', value: '0', color: 'var(--ink)' },
          { label: 'Текущий баланс', value: '0 ₽', color: 'var(--ink)', highlight: true },
        ].map((s) => (
          <Card key={s.label} className={s.highlight ? 'bg-[var(--surface-inset)]' : ''}>
            <p className="text-[12px] text-[var(--ink-4)] uppercase tracking-[0.1em] font-medium mb-[8px]">{s.label}</p>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 500, color: s.color }}>
              {s.value}
            </p>
          </Card>
        ))}
      </div>

      <Card pad={false}>
        <div className="px-[20px] py-[60px] text-center">
          <p className="text-[13px] text-[var(--ink-4)]">Платежей пока нет</p>
        </div>
      </Card>
    </div>
  )
}
