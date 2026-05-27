import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export default function CounterpartiesPage() {
  return (
    <div className="max-w-[1080px]">
      <div className="flex items-center justify-between mb-[24px]">
        <div>
          <h2 style={{ fontSize: 24, marginBottom: 4 }}>Контрагенты</h2>
          <p className="text-[14px] text-[var(--ink-3)]">Организации и ИП, с которыми вы работаете</p>
        </div>
        <Button variant="primary">+ Добавить контрагента</Button>
      </div>
      <Card pad={false}>
        <div className="px-[20px] py-[60px] text-center">
          <p className="text-[14px] font-medium text-[var(--ink-2)] mb-[8px]">Контрагентов пока нет</p>
          <p className="text-[13px] text-[var(--ink-4)] mb-[20px]">Добавьте первого контрагента чтобы начать</p>
          <Button variant="secondary">Добавить контрагента</Button>
        </div>
      </Card>
    </div>
  )
}
