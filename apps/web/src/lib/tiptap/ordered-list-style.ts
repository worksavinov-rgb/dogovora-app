'use client'

/**
 * OrderedListStyle — стиль нумерации нумерованного списка, хранимый ЧЕРЕЗ class
 * на <ol> (ol-legal / ol-alpha / ol-roman). Не inline-стиль — его режет
 * sanitizeHtml (lib/html-document.ts); класс переживает сохранение и экспорт.
 *
 * Сам пересчёт номеров при добавлении/удалении пункта делает браузер (нативный
 * <ol>) + CSS-счётчики (globals.css). Многоуровневая нумерация «1.», «1.1.»,
 * «1.1.1.» — через counters(item, "."). DOCX-конвертер читает те же классы.
 *
 * Дефолт — 'legal' (арабские с точками): классический стиль российских договоров.
 * Для НОВЫХ списков; номера из загруженного Word остаются обычным текстом.
 */

import { Extension } from '@tiptap/react'

export type OrderedListStyleValue = 'legal' | 'alpha' | 'roman'
export const ORDERED_LIST_STYLES: OrderedListStyleValue[] = ['legal', 'alpha', 'roman']
export const DEFAULT_ORDERED_LIST_STYLE: OrderedListStyleValue = 'legal'

const CLASS_RE = /\bol-(legal|alpha|roman)\b/

export const OrderedListStyle = Extension.create({
  name: 'orderedListStyle',

  addGlobalAttributes() {
    return [
      {
        types: ['orderedList'],
        attributes: {
          listStyle: {
            default: DEFAULT_ORDERED_LIST_STYLE,
            parseHTML: (element: HTMLElement) => {
              const m = (element.getAttribute('class') ?? '').match(CLASS_RE)
              return m ? m[1] : DEFAULT_ORDERED_LIST_STYLE
            },
            renderHTML: (attributes: { listStyle?: string | null }) => {
              const style = attributes.listStyle || DEFAULT_ORDERED_LIST_STYLE
              return { class: `ol-${style}` }
            },
          },
        },
      },
    ]
  },
})
