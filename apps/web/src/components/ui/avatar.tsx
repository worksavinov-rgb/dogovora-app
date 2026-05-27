import * as React from 'react'

interface AvatarProps {
  name: string
  size?: number
  className?: string
}

/** Генерирует hue-цвет из первой буквы имени */
function nameToHue(name: string): number {
  const char = name.trim().toUpperCase().charCodeAt(0)
  return ((char - 65) * 13.8) % 360
}

export function Avatar({ name, size = 28, className = '' }: AvatarProps) {
  const hue = nameToHue(name)
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')

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
