import * as React from 'react'

interface AvatarProps {
  name: string
  size?: number
  className?: string
}

// Юр-формы, которые не должны попадать в инициалы (ООО «Ромашка» → «Р», а не «О»)
const LEGAL_FORMS = new Set([
  'ООО', 'ОАО', 'АО', 'ПАО', 'ЗАО', 'АНО', 'НКО', 'ИП', 'ФГУП', 'МУП', 'ГУП', 'ТСЖ',
])

/** Значимые слова имени без юр-формы и кавычек/пунктуации */
function meaningfulWords(name: string): string[] {
  const words = name
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[«»"'`.,()]/g, ''))
    .filter(Boolean)
  if (words.length > 1 && LEGAL_FORMS.has(words[0].toUpperCase())) return words.slice(1)
  return words
}

/** Генерирует hue-цвет из первой значимой буквы имени */
function nameToHue(name: string): number {
  const first = meaningfulWords(name)[0] ?? name.trim()
  const char = first.toUpperCase().charCodeAt(0) || 65
  return ((char - 65) * 13.8 + 360) % 360
}

export function Avatar({ name, size = 28, className = '' }: AvatarProps) {
  const hue = nameToHue(name)
  const initials = meaningfulWords(name)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || (name.trim()[0]?.toUpperCase() ?? '?')

  const bgColor = `oklch(0.92 0.03 ${hue})`
  const textColor = `oklch(0.38 0.05 ${hue})`
  const fontSize = Math.round(size * 0.4)

  return (
    <div
      className={[
        'inline-flex items-center justify-center rounded-full border border-[var(--line)] shrink-0 font-semibold select-none',
        className,
      ].join(' ')}
      style={{
        width: size,
        height: size,
        backgroundColor: bgColor,
        color: textColor,
        fontSize,
      }}
      aria-label={name}
    >
      {initials}
    </div>
  )
}
