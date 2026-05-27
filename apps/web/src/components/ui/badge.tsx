import * as React from 'react'

export type BadgeVariant = 'draft' | 'progress' | 'review' | 'approved' | 'paid' | 'danger' | 'default'

interface BadgeProps {
  variant?: BadgeVariant
  children: React.ReactNode
  className?: string
}

const variantStyles: Record<BadgeVariant, string> = {
  default:   'text-[var(--ink-2)] bg-[var(--surface)] border-[var(--line-2)]',
  draft:     'text-[var(--ink-3)] bg-[var(--surface-inset)] border-[var(--line-2)]',
  progress:  'text-[oklch(0.45_0.10_235)] bg-[var(--info-soft)] border-[oklch(0.85_0.04_235)]',
  review:    'text-[oklch(0.45_0.10_75)] bg-[var(--warn-soft)] border-[oklch(0.85_0.06_75)]',
  approved:  'text-[var(--ok)] bg-[var(--ok-soft)] border-[oklch(0.85_0.04_155)]',
  paid:      'text-[var(--accent-ink)] bg-[var(--accent-soft)] border-[oklch(0.85_0.03_260)]',
  danger:    'text-[var(--danger)] bg-[var(--danger-soft)] border-[oklch(0.85_0.05_25)]',
}

const variantLabels: Record<BadgeVariant, string> = {
  default:  '',
  draft:    'Черновик',
  progress: 'В работе',
  review:   'На проверке',
  approved: 'Утверждено',
  paid:     'Оплачено',
  danger:   'Требует внимания',
}

export function Badge({ variant = 'default', children, className = '' }: BadgeProps) {
  return (
    <span
      className={[
        'inline-flex items-center gap-[6px] h-[22px] px-[8px]',
        'rounded-full text-[12px] font-medium border whitespace-nowrap',
        variantStyles[variant],
        className,
      ].join(' ')}
    >
      {/* Точка */}
      <span
        className="w-[6px] h-[6px] rounded-full bg-current opacity-60 shrink-0"
        aria-hidden="true"
      />
      {children}
    </span>
  )
}

/** Хелпер: автоматически подбирает вариант по статусу */
export function StatusBadge({ status }: { status: BadgeVariant }) {
  return <Badge variant={status}>{variantLabels[status]}</Badge>
}
