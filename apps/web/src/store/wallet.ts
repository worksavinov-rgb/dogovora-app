import { create } from 'zustand'

interface WalletStore {
  balance: number | null
  loading: boolean
  fetch: () => Promise<void>
  setBalance: (b: number) => void
}

export const useWalletStore = create<WalletStore>((set) => ({
  balance: null,
  loading: false,

  fetch: async () => {
    set({ loading: true })
    try {
      const res = await fetch('/api/wallet')
      if (res.ok) {
        const data = await res.json()
        set({ balance: data.balance })
      }
    } finally {
      set({ loading: false })
    }
  },

  setBalance: (balance) => set({ balance }),
}))
