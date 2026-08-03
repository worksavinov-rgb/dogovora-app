import * as React from 'react'

/* ─── Checkbox ───────────────────────────────────────────────────────────────
   Компактный чекбокс дизайн-системы. Метка — children, кликабельна целиком.
   Вариант `compact` — для блока согласий: мелкий текст, выравнивание по верху.
   ────────────────────────────────────────────────────────────────────────── */

interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  children: React.ReactNode
  error?: boolean
  compact?: boolean
}

export function Checkbox({
  children,
  error = false,
  compact = false,
  className = '',
  disabled,
  ...props
}: CheckboxProps) {
  return (
    <label
      className={[
        'flex gap-[9px] cursor-pointer select-none group',
        compact ? 'items-start' : 'items-center',
        disabled ? 'opacity-50 cursor-not-allowed' : '',
        className,
      ].join(' ')}
    >
      <span className={['relative shrink-0', compact ? 'mt-[1px]' : ''].join(' ')}>
        <input
          type="checkbox"
          disabled={disabled}
          className={[
            'peer appearance-none w-[16px] h-[16px] m-0 cursor-pointer',
            'rounded-[var(--radius-xs)] bg-[var(--surface)]',
            'border transition-[border-color,background-color,box-shadow] duration-[120ms]',
            error ? 'border-[var(--danger)]' : 'border-[var(--line-strong)]',
            'checked:bg-[var(--ink)] checked:border-[var(--ink)]',
            'focus-visible:outline-none focus-visible:shadow-[var(--sh-focus)]',
            'disabled:cursor-not-allowed',
          ].join(' ')}
          {...props}
        />
        {/* Галочка */}
        <svg
          className="absolute left-[3px] top-[4px] w-[10px] h-[10px] pointer-events-none opacity-0 peer-checked:opacity-100 transition-opacity duration-[120ms]"
          viewBox="0 0 12 12"
          fill="none"
          stroke="#FFFFFF"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M1.5 6.5 4.5 9.5 10.5 2.5" />
        </svg>
      </span>

      <span
        className={[
          'text-[var(--ink-2)] leading-[1.5]',
          compact ? 'text-[12px]' : 'text-[13px]',
        ].join(' ')}
      >
        {children}
      </span>
    </label>
  )
}
