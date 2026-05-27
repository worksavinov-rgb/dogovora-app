export type ProfileType = 'INDIVIDUAL' | 'SOLE_PROPRIETOR' | 'COMPANY'

export interface User {
  id: string
  email: string
  createdAt: string
}

export interface Profile {
  id: string
  userId: string
  type: ProfileType
  name: string
  inn?: string
  kpp?: string
  ogrn?: string
  legalAddress?: string
  signatureFilePath?: string
  stampFilePath?: string
}

export interface BankDetail {
  id: string
  profileId?: string
  counterpartyId?: string
  bankName: string
  bik: string
  checkingAccount: string
  correspondentAccount: string
}
