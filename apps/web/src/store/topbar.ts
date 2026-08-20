import { create } from 'zustand'

interface TopbarState {
  pageTitle: string | null
  setPageTitle: (title: string | null) => void
  /**
   * Рабочий экран прячет верхнюю полосу: она там почти пустая, а каждый
   * пиксель высоты нужен листу договора. Баланс страница показывает сама.
   */
  hideTopbar: boolean
  setHideTopbar: (hide: boolean) => void
}

export const useTopbarStore = create<TopbarState>((set) => ({
  pageTitle: null,
  setPageTitle: (title) => set({ pageTitle: title }),
  hideTopbar: false,
  setHideTopbar: (hide) => set({ hideTopbar: hide }),
}))
