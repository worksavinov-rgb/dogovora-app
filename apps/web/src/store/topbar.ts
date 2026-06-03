import { create } from 'zustand'

interface TopbarState {
  pageTitle: string | null
  setPageTitle: (title: string | null) => void
}

export const useTopbarStore = create<TopbarState>((set) => ({
  pageTitle: null,
  setPageTitle: (title) => set({ pageTitle: title }),
}))
