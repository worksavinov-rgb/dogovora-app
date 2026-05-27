'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge, StatusBadge } from '@/components/ui/badge'
import { Card, CardHeader } from '@/components/ui/card'
import { Input, Textarea, Select, Field } from '@/components/ui/input'
import { Slider } from '@/components/ui/slider'
import { Avatar } from '@/components/ui/avatar'
import { Tabs } from '@/components/ui/tabs'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-[48px]">
      <p className="text-[11px] font-medium text-[var(--ink-4)] uppercase tracking-[0.12em] mb-[20px]">
        {title}
      </p>
      {children}
    </section>
  )
}

export default function UIKitPage() {
  const [sliderValue, setSliderValue] = useState(65)
  const [sizeValue, setSizeValue] = useState(8400)
  const [activeTab, setActiveTab] = useState('all')
  const [textareaValue, setTextareaValue] = useState('')

  return (
    <div className="max-w-[860px] mx-auto py-[48px] px-[24px]">
      {/* Заголовок */}
      <div className="mb-[48px]">
        <h1 className="text-[48px] font-[var(--font-display)] font-normal text-[var(--ink)] mb-[8px]">
          UI Kit
        </h1>
        <p className="text-[var(--ink-3)] text-[15px]">
          Все компоненты дизайн-системы «Договора»
        </p>
      </div>

      {/* ── Типографика ── */}
      <Section title="Типографика">
        <div className="flex flex-col gap-[16px]">
          <h1 className="text-[48px]">Заголовок H1 — Source Serif 4</h1>
          <h2 className="text-[32px]">Заголовок H2 — Договор №123</h2>
          <h3 className="text-[22px]">Заголовок H3 — ООО «Ромашка»</h3>
          <p className="text-[15px] text-[var(--ink)]">Body text — Основной текст интерфейса. Используется IBM Plex Sans для всех элементов UI.</p>
          <p className="text-[13px] text-[var(--ink-3)]">Meta text — дата, описание, подсказки</p>
          <p className="font-[var(--font-mono)] text-[14px] text-[var(--ink)]">
            Mono: 7707083893 · БИК 044525974 · v.4 · +342 / −188
          </p>
          <div className="flex items-baseline gap-[8px]">
            <span className="font-[var(--font-display)] text-[56px] font-normal text-[var(--ink)]">
              12 450 ₽
            </span>
            <span className="text-[var(--ink-3)] text-[14px]">Баланс</span>
          </div>
        </div>
      </Section>

      {/* ── Кнопки ── */}
      <Section title="Button — кнопки">
        <div className="flex flex-col gap-[16px]">
          <div className="flex flex-wrap items-center gap-[12px]">
            <Button variant="primary">Утвердить версию</Button>
            <Button variant="secondary">Создать документ</Button>
            <Button variant="ghost">Отмена</Button>
            <Button variant="accent" icon={<span>✦</span>}>Применить ИИ</Button>
            <Button variant="danger">Удалить</Button>
          </div>
          <div className="flex flex-wrap items-center gap-[12px]">
            <Button variant="primary" size="sm">Маленькая</Button>
            <Button variant="secondary" size="md">Средняя</Button>
            <Button variant="ghost" size="lg">Большая</Button>
          </div>
          <div className="flex flex-wrap items-center gap-[12px]">
            <Button variant="primary" loading>Загрузка...</Button>
            <Button variant="secondary" disabled>Недоступно</Button>
          </div>
        </div>
      </Section>

      {/* ── Бейджи ── */}
      <Section title="Badge — статусы">
        <div className="flex flex-wrap items-center gap-[10px]">
          <StatusBadge status="draft" />
          <StatusBadge status="progress" />
          <StatusBadge status="review" />
          <StatusBadge status="approved" />
          <StatusBadge status="paid" />
          <StatusBadge status="danger" />
          <Badge>Произвольный текст</Badge>
        </div>
      </Section>

      {/* ── Карточки ── */}
      <Section title="Card — карточки">
        <div className="grid grid-cols-2 gap-[16px]">
          <Card>
            <CardHeader>
              <h3 className="text-[16px] font-medium">Карточка с заголовком</h3>
              <Button variant="ghost" size="sm">Изменить</Button>
            </CardHeader>
            <p className="text-[13px] text-[var(--ink-3)]">Обычная карточка с padding 20px</p>
          </Card>
          <Card shadow>
            <p className="text-[13px] font-medium mb-[4px]">С тенью</p>
            <p className="text-[13px] text-[var(--ink-3)]">shadow-2 для выделения</p>
          </Card>
        </div>
      </Section>

      {/* ── Поля ввода ── */}
      <Section title="Input / Textarea / Select — поля">
        <div className="flex flex-col gap-[16px] max-w-[480px]">
          <Field label="Название организации" htmlFor="org-name">
            <Input id="org-name" placeholder="ООО «Ромашка»" />
          </Field>
          <Field label="ИНН" htmlFor="inn">
            <Input id="inn" placeholder="7707083893" className="font-[var(--font-mono)]" />
          </Field>
          <Field label="С ошибкой" htmlFor="error-field">
            <Input id="error-field" value="неверный ИНН" error="ИНН должен содержать 10 или 12 цифр" readOnly />
          </Field>
          <Field label="Описание для ИИ" htmlFor="ai-desc">
            <Textarea
              id="ai-desc"
              placeholder="Опишите что нужно включить в договор..."
              value={textareaValue}
              onChange={(e) => setTextareaValue(e.target.value)}
              charCount={textareaValue.length}
              maxChars={20000}
              style={{ minHeight: 100 }}
            />
          </Field>
          <Field label="Тип документа" htmlFor="doc-type">
            <Select id="doc-type" placeholder="Выберите тип">
              <option value="contract">Договор</option>
              <option value="appendix">Приложение</option>
              <option value="amendment">Доп. соглашение</option>
            </Select>
          </Field>
        </div>
      </Section>

      {/* ── Слайдер ── */}
      <Section title="Slider — AI-настройки">
        <div className="flex flex-col gap-[24px] max-w-[480px]">
          <Slider
            label="Уровень юридической защищённости"
            value={sliderValue}
            min={20}
            max={90}
            formatValue={(v) => `${v}%`}
            hint="20% — Дружелюбный · 55% — Сбалансированный · 90% — Жёсткий"
            onChange={setSliderValue}
          />
          <Slider
            label="Целевой объём"
            value={sizeValue}
            min={100}
            max={20000}
            step={100}
            formatValue={(v) => `${v.toLocaleString('ru')} зн.`}
            hint="Рекомендуется 5 000–12 000 знаков для стандартного договора"
            onChange={setSizeValue}
          />
        </div>
      </Section>

      {/* ── Avatar ── */}
      <Section title="Avatar — аватарки">
        <div className="flex items-center gap-[16px]">
          {['Павел Савинов', 'Андрей Иванов', 'ООО Ромашка', 'Бета Корп', 'Дмитрий'].map((name) => (
            <div key={name} className="flex flex-col items-center gap-[8px]">
              <Avatar name={name} size={36} />
              <span className="text-[11px] text-[var(--ink-4)] max-w-[60px] text-center leading-tight">{name}</span>
            </div>
          ))}
          <Avatar name="ИП" size={28} />
          <Avatar name="ИП" size={40} />
          <Avatar name="ИП" size={56} />
        </div>
      </Section>

      {/* ── Tabs ── */}
      <Section title="Tabs — вкладки">
        <Tabs
          tabs={[
            { id: 'all', label: 'Все', count: 24 },
            { id: 'active', label: 'Активные', count: 8 },
            { id: 'archive', label: 'Архив', count: 16 },
          ]}
          active={activeTab}
          onChange={setActiveTab}
          className="mb-[20px]"
        />
        <Card>
          <p className="text-[13px] text-[var(--ink-3)]">
            Активная вкладка: <strong className="text-[var(--ink)]">{activeTab}</strong>
          </p>
        </Card>
      </Section>

      {/* ── Цветовая палитра ── */}
      <Section title="Цветовая палитра">
        <div className="grid grid-cols-5 gap-[8px]">
          {[
            { name: 'bg', color: 'var(--bg)', label: '#FAF8F3' },
            { name: 'bg-soft', color: 'var(--bg-soft)', label: '#F4F1E9' },
            { name: 'surface', color: 'var(--surface)', label: '#FFFFFF' },
            { name: 'surface-2', color: 'var(--surface-2)', label: '#FBFAF6' },
            { name: 'surface-inset', color: 'var(--surface-inset)', label: '#F6F3EC' },
            { name: 'ink', color: 'var(--ink)', label: '#18181B' },
            { name: 'ink-2', color: 'var(--ink-2)', label: '#3F3F46' },
            { name: 'ink-3', color: 'var(--ink-3)', label: '#6B6962' },
            { name: 'ink-4', color: 'var(--ink-4)', label: '#A09D94' },
            { name: 'ink-5', color: 'var(--ink-5)', label: '#C8C5BC' },
            { name: 'accent', color: 'var(--accent)', label: 'slate-indigo' },
            { name: 'accent-soft', color: 'var(--accent-soft)', label: 'soft' },
            { name: 'ok', color: 'var(--ok)', label: 'success' },
            { name: 'ok-soft', color: 'var(--ok-soft)', label: 'soft' },
            { name: 'warn', color: 'var(--warn)', label: 'warning' },
            { name: 'warn-soft', color: 'var(--warn-soft)', label: 'soft' },
            { name: 'danger', color: 'var(--danger)', label: 'danger' },
            { name: 'danger-soft', color: 'var(--danger-soft)', label: 'soft' },
            { name: 'info', color: 'var(--info)', label: 'info' },
            { name: 'info-soft', color: 'var(--info-soft)', label: 'soft' },
          ].map((item) => (
            <div key={item.name}>
              <div
                className="h-[40px] rounded-[var(--radius-md)] border border-[var(--line)] mb-[6px]"
                style={{ backgroundColor: item.color }}
              />
              <p className="text-[11px] font-medium text-[var(--ink-3)]">{item.name}</p>
              <p className="text-[10px] text-[var(--ink-5)] font-[var(--font-mono)]">{item.label}</p>
            </div>
          ))}
        </div>
      </Section>
    </div>
  )
}
