'use client'

import * as React from 'react'

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step?: number
  hint?: string
  formatValue?: (v: number) => string
  onChange: (value: number) => void
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  hint,
  formatValue,
  onChange,
}: SliderProps) {
  const percent = ((value - min) / (max - min)) * 100

  return (
    <div className="flex flex-col gap-[8px]">
      {/* Заголовок */}
      <div className="flex items-center justify-between">
        <span className="text-[14px] font-medium text-[var(--ink-2)]">{label}</span>
        <span className="font-[var(--font-mono)] text-[14px] font-medium text-[var(--ink)] tabular-nums">
          {formatValue ? formatValue(value) : value}
        </span>
      </div>

      {/* Трек */}
      <div className="relative h-[20px] flex items-center">
        {/* Фоновый трек */}
        <div className="absolute inset-x-0 h-[2px] rounded-full bg-[var(--line)]" />
        {/* Заполненная часть */}
        <div
          className="absolute h-[2px] rounded-full bg-[var(--ink)] transition-[width] duration-[60ms]"
          style={{ width: `${percent}%` }}
        />
        {/* Нативный input[range] */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          style={{ zIndex: 2 }}
        />
        {/* Кастомный ползунок */}
        <div
          className="absolute w-[16px] h-[16px] rounded-full bg-white border-2 border-[var(--ink)] shadow-[0_1px_3px_rgba(0,0,0,0.15)] transition-[left] duration-[60ms] pointer-events-none"
          style={{ left: `calc(${percent}% - 8px)`, zIndex: 1 }}
        />
      </div>

      {hint && (
        <p className="text-[12px] text-[var(--ink-3)]">{hint}</p>
      )}
    </div>
  )
}
