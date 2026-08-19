'use client'

/**
 * TextAlignClass — выравнивание абзацев/заголовков, хранимое ЧЕРЕЗ class
 * (ta-left / ta-center / ta-right / ta-justify), а не inline-стилем.
 *
 * Зачем свой вместо @tiptap/extension-text-align: штатное расширение пишет
 * `style="text-align:…"`, а sanitizeHtml (lib/html-document.ts) вырезает все
 * inline-стили. Класс же переживает и сохранение, и экспорт в DOCX — конвертер
 * (packages/shared/formatting/html-docx-converter.ts) читает эти же классы.
 *
 * Регистрирует только глобальный атрибут `textAlign` на paragraph/heading.
 * Выставляется из тулбара через editor.updateAttributes (см. editor-toolbar.tsx).
 */

import { Extension } from '@tiptap/react'

export type TextAlignValue = 'left' | 'center' | 'right' | 'justify'

// Типы узлов, которые несут выравнивание
export const TEXT_ALIGN_TYPES = ['paragraph', 'heading'] as const

const CLASS_RE = /\bta-(left|center|right|justify)\b/

export const TextAlignClass = Extension.create({
  name: 'textAlignClass',

  addGlobalAttributes() {
    return [
      {
        types: [...TEXT_ALIGN_TYPES],
        attributes: {
          textAlign: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const m = (element.getAttribute('class') ?? '').match(CLASS_RE)
              return m ? m[1] : null
            },
            renderHTML: (attributes: { textAlign?: string | null }) => {
              if (!attributes.textAlign) return {}
              return { class: `ta-${attributes.textAlign}` }
            },
          },
        },
      },
    ]
  },
})
