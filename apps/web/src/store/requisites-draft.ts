import { create } from 'zustand'
import type { ParsedRequisites } from '@/lib/requisites-parser'

/**
 * Передача распознанных реквизитов от окна выбора на странице списка к форме
 * нового контрагента — в памяти вкладки, одноразово.
 *
 * Почему не через адресную строку: там оказались бы ИНН, счета и адрес, а адресная
 * строка попадает в историю браузера и в логи прокси. Стор очищается сразу после
 * того, как форма его прочитала, и не переживает перезагрузку страницы.
 */
interface RequisitesDraft {
  fields: ParsedRequisites
  fileName: string
}

interface RequisitesDraftState {
  draft: RequisitesDraft | null
  setDraft: (draft: RequisitesDraft) => void
  /**
   * Очистка отделена от чтения намеренно: форма читает черновик при первом
   * построении (ленивой инициализацией состояния), а стирает его эффектом.
   * Если стирать прямо при чтении, обновление состояния попадёт внутрь рендера
   * и потянет лишний каскад перерисовок.
   */
  clear: () => void
}

export const useRequisitesDraftStore = create<RequisitesDraftState>((set) => ({
  draft: null,
  setDraft: (draft) => set({ draft }),
  clear: () => set({ draft: null }),
}))
