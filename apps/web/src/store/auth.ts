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
  /** true — пользователь ещё не принял обязательные согласия или вышла новая редакция */
  needsConsent: boolean

  setUser: (user: AuthUser | null) => void
  setBalance: (balance: number) => void
  setNeedsConsent: (needsConsent: boolean) => void
  initialize: () => Promise<void>
  logout: () => Promise<void>
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  balance: 0,
  isLoading: false,
  isInitialized: false,
  needsConsent: false,

  setUser: (user) => set({ user }),
  setBalance: (balance) => set({ balance }),
  setNeedsConsent: (needsConsent) => set({ needsConsent }),

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
          consents?: { needsAcceptance?: boolean }
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
          needsConsent: data.consents?.needsAcceptance === true,
        })
      } else {
        set({ user: null, needsConsent: false })
      }
    } catch {
      set({ user: null, needsConsent: false })
    } finally {
      set({ isLoading: false, isInitialized: true })
    }
  },

  logout: async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    set({ user: null, balance: 0, needsConsent: false })
  },
}))
