export type SignatoryBasis =
  | 'CHARTER'
  | 'POA'
  | 'CERTIFICATE'
  | 'REGULATION'
  | 'OTHER'

export type DocumentScope = 'CONTRACT' | 'APPENDIX' | 'AMENDMENT' | 'ACT'

export interface Counterparty {
  id: string
  userId: string
  name: string
  inn?: string
  kpp?: string
  ogrn?: string
  legalAddress?: string
  email?: string
  phone?: string
  isArchived: boolean
  createdAt: string
}

export interface Signatory {
  id: string
  counterpartyId: string
  fullName: string
  signatureName: string
  position: string
  basisType: SignatoryBasis
  poaNumber?: string
  poaDate?: string
  poaExpiry?: string
  poaFilePath?: string
  scopes: DocumentScope[]
  isDefault: boolean
}
