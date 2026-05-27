export type DocumentType = 'CONTRACT' | 'APPENDIX' | 'AMENDMENT'

export type VersionStatus =
  | 'DRAFT'
  | 'IN_PROGRESS'
  | 'REVIEW'
  | 'APPROVED'
  | 'PAID'

export type ChatRole = 'USER' | 'AI' | 'WARNING'

export interface AISettings {
  protectionLevel: number   // 20–90
  targetSize: number        // 100–20000 символов
  customInstruction: string // до 20000 символов
}

export interface Document {
  id: string
  userId: string
  counterpartyId: string
  title: string
  number?: string
  type: DocumentType
  createdAt: string
  updatedAt: string
}

export interface Version {
  id: string
  documentId: string
  number: number
  status: VersionStatus
  filePath?: string
  fileSize?: number
  aiSettings: AISettings
  createdAt: string
  purchase?: Purchase
}

export interface ChatMessage {
  id: string
  versionId: string
  role: ChatRole
  content: string
  createdAt: string
}

export interface Purchase {
  id: string
  versionId: string
  amount: number
  purchasedAt: string
}
