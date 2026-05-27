import * as React from 'react'

interface CardProps {
  children: React.ReactNode
  className?: string
  pad?: boolean       // false = без padding (для таблиц внутри)
  shadow?: boolean
  onClick?: () => void
}

export function Card({ children, className = '', pad = true, shadow = false, onClick }: CardProps) {
  return (
    <div
      className={[
        'bg-[var(--surface)] border border-[var(--line)] rounded-[var(--radius-lg)]',
        pad ? 'p-5' : '',
        shadow ? 'shadow-[var(--shadow-2)]' : '',
        onClick ? 'cursor-pointer hover:border-[var(--line-strong)] transition-colors duration-120' : '',
        className,
      ].join(' ')}
      onClick={onClick}
    >
      {children}
    </div>
  )
}

/** Заголовок карточки */
export function CardHeader({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={['flex items-center justify-between mb-4', className].join(' ')}>
      {children}
    </div>
  )
}

/** Разделитель внутри карточки (на всю ширину при pad={false}) */
export function CardDivider() {
  return <hr className="border-0 border-t border-[var(--line)] my-0" />
}
