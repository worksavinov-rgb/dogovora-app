import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export default function RequisitesPage() {
  return (
    <div className="max-w-[800px]">
      <div className="flex items-center justify-between mb-[24px]">
        <div>
          <h2 style={{ fontSize: 24, marginBottom: 4 }}>Мои реквизиты</h2>
          <p className="text-[14px] text-[var(--ink-3)]">Данные вашей организации или ИП для подстановки в договоры</p>
        </div>
        <Button variant="primary">+ Добавить профиль</Button>
      </div>
      <Card pad={false}>
        <div className="px-[20px] py-[60px] text-center">
          <p className="text-[14px] font-medium text-[var(--ink-2)] mb-[8px]">Реквизиты не заполнены</p>
          <p className="text-[13px] text-[var(--ink-4)] mb-[20px]">Добавьте реквизиты вашей организации или ИП</p>
          <Button variant="secondary">Заполнить реквизиты</Button>
        </div>
      </Card>
    </div>
  )
}
