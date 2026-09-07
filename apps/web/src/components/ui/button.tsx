import * as React from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'accent' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: React.ReactNode
  iconRight?: React.ReactNode
  loading?: boolean
}

const variantStyles: Record<ButtonVariant, string> = {
  primary: [
    'bg-[var(--ink)] text-white border-[var(--ink)]',
    'hover:bg-black',
    'disabled:opacity-40',
  ].join(' '),
  secondary: [
    'bg-[var(--surface)] text-[var(--ink)] border-[var(--line-2)]',
    'hover:border-[var(--line-strong)] hover:bg-[var(--surface-2)]',
    'disabled:opacity-40',
  ].join(' '),
  ghost: [
    'bg-transparent text-[var(--ink-2)] border-transparent',
    'hover:bg-[var(--surface-inset)] hover:text-[var(--ink)]',
    'disabled:opacity-40',
  ].join(' '),
  accent: [
    'bg-[var(--accent)] text-white border-[var(--accent)]',
    'hover:bg-[var(--accent-hover)] hover:border-[var(--accent-hover)]',
    'disabled:opacity-40',
  ].join(' '),
  danger: [
    'bg-[var(--surface)] text-[var(--danger)] border-[var(--line-2)]',
    'hover:bg-[var(--danger-soft)] hover:border-[var(--danger)]',
    'disabled:opacity-40',
  ].join(' '),
}

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'h-[30px] px-[10px] text-[13px] gap-[6px]',
  md: 'h-[36px] px-[14px] text-[14px] gap-[8px]',
  lg: 'h-[44px] px-[18px] text-[15px] gap-[8px]',
}

const iconSizeStyles: Record<ButtonSize, string> = {
  sm: '[&_svg]:w-[14px] [&_svg]:h-[14px]',
  md: '[&_svg]:w-[16px] [&_svg]:h-[16px]',
  lg: '[&_svg]:w-[16px] [&_svg]:h-[16px]',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  iconRight,
  loading = false,
  className = '',
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      className={[
        'inline-flex items-center justify-center rounded-[var(--radius-md)] border font-medium',
        'transition-[background,border-color,color] duration-[120ms]',
        'cursor-pointer whitespace-nowrap leading-none',
        'focus-visible:outline-none focus-visible:shadow-[var(--sh-focus)]',
        variantStyles[variant],
        sizeStyles[size],
        iconSizeStyles[size],
        className,
      ].join(' ')}
      disabled={disabled ?? loading}
      {...props}
    >
      {loading ? (
        <svg className="animate-spin" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="2" strokeOpacity="0.25" />
          <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      ) : (
        icon
      )}
      {children}
      {iconRight && !loading && iconRight}
    </button>
  )
}
