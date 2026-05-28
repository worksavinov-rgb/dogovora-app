interface SkeletonProps {
  className?: string
  style?: React.CSSProperties
}

export function Skeleton({ className, style }: SkeletonProps) {
  return (
    <div
      className={['rounded-[var(--radius-sm)] animate-pulse', className].filter(Boolean).join(' ')}
      style={{ background: 'var(--surface-inset)', ...style }}
    />
  )
}

// Готовые скелетоны для конкретных компонентов

export function DocumentRowSkeleton() {
  return (
    <div className="flex items-center gap-[12px] px-[20px] py-[12px]" style={{ borderBottom: '1px solid var(--line)' }}>
      <Skeleton className="w-[28px] h-[28px] shrink-0" />
      <div className="flex-1 flex flex-col gap-[6px]">
        <Skeleton className="h-[13px] w-[60%]" />
        <Skeleton className="h-[11px] w-[35%]" />
      </div>
      <Skeleton className="h-[20px] w-[70px] rounded-full" />
      <Skeleton className="h-[11px] w-[24px]" />
      <Skeleton className="h-[11px] w-[40px]" />
    </div>
  )
}

export function CounterpartyRowSkeleton() {
  return (
    <div className="flex items-center gap-[12px] px-[20px] py-[14px]" style={{ borderBottom: '1px solid var(--line)' }}>
      <Skeleton className="w-[36px] h-[36px] rounded-full shrink-0" />
      <div className="flex-1 flex flex-col gap-[6px]">
        <Skeleton className="h-[13px] w-[50%]" />
        <Skeleton className="h-[11px] w-[30%]" />
      </div>
      <Skeleton className="h-[11px] w-[60px]" />
    </div>
  )
}

export function VersionRowSkeleton() {
  return (
    <div className="flex items-center gap-[12px] px-[20px] py-[12px]" style={{ borderBottom: '1px solid var(--line)' }}>
      <Skeleton className="h-[11px] w-[30px]" />
      <Skeleton className="w-[28px] h-[28px] shrink-0" />
      <div className="flex-1 flex flex-col gap-[6px]">
        <Skeleton className="h-[13px] w-[55%]" />
        <Skeleton className="h-[11px] w-[20%]" />
      </div>
      <Skeleton className="h-[20px] w-[80px] rounded-full" />
    </div>
  )
}

export function CardSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="rounded-[var(--radius-lg)] p-[20px]" style={{ border: '1px solid var(--line)', background: 'var(--bg)' }}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-[13px] mb-[10px]" style={{ width: `${60 + Math.random() * 30}%` }} />
      ))}
    </div>
  )
}
