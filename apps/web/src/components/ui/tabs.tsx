'use client'

import * as React from 'react'

interface Tab {
  id: string
  label: string
  count?: number
}

interface TabsProps {
  tabs: Tab[]
  active: string
  onChange: (id: string) => void
  className?: string
}

export function Tabs({ tabs, active, onChange, className = '' }: TabsProps) {
  return (
    <div
      className={['flex gap-0 border-b border-[var(--line)]', className].join(' ')}
      role="tablist"
    >
      {tabs.map((tab) => {
        const isActive = tab.id === active
        return (
          <button
            key={tab.id}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(tab.id)}
            className={[
              'relative inline-flex items-center gap-[6px] h-[40px] px-[16px]',
              'text-[14px] font-medium cursor-pointer border-0 bg-transparent',
              'transition-colors duration-[120ms] whitespace-nowrap',
              isActive
                ? 'text-[var(--ink)]'
                : 'text-[var(--ink-3)] hover:text-[var(--ink-2)]',
            ].join(' ')}
          >
            {tab.label}
            {tab.count !== undefined && (
              <span
                className={[
                  'inline-flex items-center justify-center min-w-[18px] h-[18px] px-[5px]',
                  'rounded-full text-[11px] font-medium',
                  isActive
                    ? 'bg-[var(--surface-inset)] text-[var(--ink-2)]'
                    : 'bg-[var(--surface-inset)] text-[var(--ink-4)]',
                ].join(' ')}
              >
                {tab.count}
              </span>
            )}
            {/* Активная линия снизу */}
            {isActive && (
              <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[var(--ink)] rounded-t-full" />
            )}
          </button>
        )
      })}
    </div>
  )
}
