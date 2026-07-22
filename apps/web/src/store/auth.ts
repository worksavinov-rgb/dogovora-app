import { create } from 'zustand'

interface AuthUser {
  id: string
  email: string
  name: string
  isAdmin?: boolean
  createdAt: string
}

interface AuthState {
  user: AuthUser | null
  balance: number
  isLoading: boolean
  isInitialized: boolean

  setUser: (user: AuthUser | null) => void
  setBalance: (balance: number) => void
  initialize: () => Promise<void>
  logout: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  balance: 0,
  isLoading: false,
  isInitialized: false,

  setUser: (user) => set({ user }),
  setBalance: (balance) => set({ balance }),

  initialize: async () => {
    set({ isLoading: true })
    try {
      let res = await fetch('/api/auth/me')
      // Access-токен мог истечь (15 мин) — пробуем продлить сессию по refresh-токену.
      if (res.status === 401) {
        const refreshed = await fetch('/api/auth/refresh', { method: 'POST' })
        if (refreshed.ok) {
          res = await fetch('/api/auth/me')
        }
      }
      if (res.ok) {
        const data = await res.json() as {
          user: AuthUser & { fullName?: string; wallet?: { balance: number } }
        }
        set({
          user: {
            id: data.user.id,
            email: data.user.email,
            name: data.user.name || data.user.fullName || data.user.email,
            isAdmin: data.user.isAdmin === true,
            createdAt: data.user.createdAt,
          },
          balance: Number(data.user.wallet?.balance ?? 0),
        })
      } else {
        set({ user: null })
      }
    } catch {
      set({ user: null })
    } finally {
      set({ isLoading: false, isInitialized: true })
    }
  },

  logout: async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    set({ user: null, balance: 0 })
  },
}))
