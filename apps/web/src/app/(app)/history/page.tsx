import { Card } from '@/components/ui/card'

export default function HistoryPage() {
  return (
    <div className="max-w-[1080px]">
      <div className="mb-[24px]">
        <h2 style={{ fontSize: 24, marginBottom: 4 }}>История версий</h2>
        <p className="text-[14px] text-[var(--ink-3)]">Все версии документов в хронологическом порядке</p>
      </div>
      <Card pad={false}>
        <div className="px-[20px] py-[60px] text-center">
          <p className="text-[14px] font-medium text-[var(--ink-2)] mb-[8px]">История пуста</p>
          <p className="text-[13px] text-[var(--ink-4)]">Здесь появятся версии после создания первого документа</p>
        </div>
      </Card>
    </div>
  )
}
