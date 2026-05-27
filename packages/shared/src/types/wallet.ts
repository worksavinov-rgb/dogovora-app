export type TransactionType = 'CREDIT' | 'DEBIT'

export interface Wallet {
  id: string
  userId: string
  balance: number
}

export interface Transaction {
  id: string
  walletId: string
  type: TransactionType
  amount: number
  description: string
  relatedVersionId?: string
  createdAt: string
}

export interface StorageQuota {
  id: string
  userId: string
  usedBytes: number
  limitBytes: number
  plan: 'STARTER' | 'BUSINESS' | 'BUREAU'
}
