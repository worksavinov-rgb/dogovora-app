import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

export default function BalancePage() {
  return (
    <div className="max-w-[800px]">
      <div className="mb-[24px]">
        <h2 style={{ fontSize: 24, marginBottom: 4 }}>Баланс</h2>
        <p className="text-[14px] text-[var(--ink-3)]">Пополнение счёта и история операций</p>
      </div>

      <div className="grid grid-cols-[1fr_360px] gap-[16px] mb-[24px]">
        <Card>
          <p className="text-[12px] text-[var(--ink-4)] uppercase tracking-[0.1em] font-medium mb-[12px]">Текущий баланс</p>
          <p style={{ fontFamily: 'var(--font-display)', fontSize: 56, fontWeight: 400, lineHeight: 1, marginBottom: 8 }}>
            0 ₽
          </p>
          <p className="text-[13px] text-[var(--ink-4)]">Пополните счёт чтобы начать работу</p>
        </Card>

        <Card>
          <p className="text-[13px] font-medium text-[var(--ink)] mb-[16px]">Пополнить баланс</p>
          <div className="grid grid-cols-3 gap-[8px] mb-[12px]">
            {[500, 1000, 2000, 3000, 5000, 10000].map((amount) => (
              <button
                key={amount}
                className="h-[36px] rounded-[var(--radius-md)] border border-[var(--line-2)] text-[13px] font-medium text-[var(--ink)] bg-[var(--surface)] hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)] transition-colors duration-[120ms] cursor-pointer"
              >
                {amount.toLocaleString('ru')} ₽
              </button>
            ))}
          </div>
          <Button variant="primary" className="w-full justify-center">Пополнить</Button>
        </Card>
      </div>

      <Card pad={false}>
        <div className="px-[20px] py-[16px] border-b border-[var(--line)]">
          <p className="text-[14px] font-medium">История операций</p>
        </div>
        <div className="px-[20px] py-[40px] text-center">
          <p className="text-[13px] text-[var(--ink-4)]">Операций пока нет</p>
        </div>
      </Card>
    </div>
  )
}
