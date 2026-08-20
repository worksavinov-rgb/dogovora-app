/**
 * Общий набор расширений редактора для всех редактируемых областей документа:
 * тела версии (DocumentViewer) и блоков оформления — шапки и реквизитов
 * (DecorEditor).
 *
 * Зачем общий: тулбар один на экран и должен работать одинаково, где бы
 * пользователь ни печатал. Раньше блоки оформления были простым
 * contentEditable, поэтому выравнивание, жирный и цвет к шапке не применялись.
 */
import StarterKit from '@tiptap/starter-kit'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { TextStyle } from '@tiptap/extension-text-style'
import { Color } from '@tiptap/extension-color'
import { Highlight } from '@tiptap/extension-highlight'
import { TextAlignClass } from './text-align-class'
import { OrderedListStyle } from './ordered-list-style'

export const TIPTAP_EXTENSIONS = [
  StarterKit,
  Table.configure({ resizable: false }),
  TableRow,
  TableCell,
  TableHeader,
  TextAlignClass,
  OrderedListStyle,
  // Цвет шрифта и жёлтая заливка — конвертер переносит их в DOCX
  TextStyle,
  Color,
  Highlight.configure({ multicolor: true }),
]
