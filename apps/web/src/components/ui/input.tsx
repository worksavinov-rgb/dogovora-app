import * as React from 'react'

/* ─── Label ─────────────────────────────────────────────────────────────── */

interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {
  children: React.ReactNode
}

export function Label({ children, className = '', ...props }: LabelProps) {
  return (
    <label
      className={['block text-[12px] font-medium text-[var(--ink-2)] mb-[6px]', className].join(' ')}
      {...props}
    >
      {children}
    </label>
  )
}

/* ─── Базовые стили полей ────────────────────────────────────────────────── */

const fieldBase = [
  'w-full font-[inherit] text-[14px] text-[var(--ink)] bg-[var(--surface)]',
  'border border-[var(--line-2)] rounded-[var(--radius-md)]',
  'px-[12px] py-[9px] outline-none',
  'placeholder:text-[var(--ink-4)]',
  'transition-[border-color,box-shadow] duration-[120ms]',
  'focus:border-[var(--accent)] focus:shadow-[var(--sh-focus)]',
  'disabled:opacity-50 disabled:cursor-not-allowed',
].join(' ')

/* ─── Input ──────────────────────────────────────────────────────────────── */

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  icon?: React.ReactNode
  error?: string
}

export function Input({ icon, error, className = '', ...props }: InputProps) {
  return (
    <div className="relative">
      {icon && (
        <span className="absolute left-[10px] top-1/2 -translate-y-1/2 text-[var(--ink-4)] [&_svg]:w-[16px] [&_svg]:h-[16px]">
          {icon}
        </span>
      )}
      <input
        className={[
          fieldBase,
          'h-[38px]',
          icon ? 'pl-[36px]' : '',
          error ? 'border-[var(--danger)] focus:border-[var(--danger)]' : '',
          className,
        ].join(' ')}
        {...props}
      />
      {error && (
        <p className="mt-[4px] text-[12px] text-[var(--danger)]">{error}</p>
      )}
    </div>
  )
}

/* ─── Textarea ───────────────────────────────────────────────────────────── */

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: string
  charCount?: number
  maxChars?: number
}

export function Textarea({ error, charCount, maxChars, className = '', ...props }: TextareaProps) {
  return (
    <div>
      <textarea
        className={[
          fieldBase,
          'min-h-[80px] resize-y leading-[1.5]',
          error ? 'border-[var(--danger)] focus:border-[var(--danger)]' : '',
          className,
        ].join(' ')}
        {...props}
      />
      <div className="flex justify-between mt-[4px]">
        {error && <p className="text-[12px] text-[var(--danger)]">{error}</p>}
        {maxChars !== undefined && charCount !== undefined && (
          <p className={['text-[12px] ml-auto', charCount > maxChars ? 'text-[var(--danger)]' : 'text-[var(--ink-4)]'].join(' ')}>
            {charCount.toLocaleString('ru')} / {maxChars.toLocaleString('ru')}
          </p>
        )}
      </div>
    </div>
  )
}

/* ─── Select ─────────────────────────────────────────────────────────────── */

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: string
  placeholder?: string
}

export function Select({ error, placeholder, className = '', children, ...props }: SelectProps) {
  return (
    <div>
      <select
        className={[
          fieldBase,
          'h-[38px] cursor-pointer appearance-none',
          'bg-[image:url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'16\' height=\'16\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%236B6962\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'%3E%3Cpath d=\'m6 9 6 6 6-6\'/%3E%3C/svg%3E")] bg-no-repeat bg-[right_10px_center]',
          'pr-[36px]',
          error ? 'border-[var(--danger)]' : '',
          className,
        ].join(' ')}
        {...props}
      >
        {placeholder && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {children}
      </select>
      {error && <p className="mt-[4px] text-[12px] text-[var(--danger)]">{error}</p>}
    </div>
  )
}

/* ─── Field (обёртка с label) ────────────────────────────────────────────── */

export function Field({
  label,
  htmlFor,
  children,
  className = '',
}: {
  label: string
  htmlFor?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={['flex flex-col', className].join(' ')}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  )
}
