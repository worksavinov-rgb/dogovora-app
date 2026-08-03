import type { LegalDocument } from './types'
import { OFFER } from './offer'
import { TERMS } from './terms'
import { PRIVACY } from './privacy'
import { PDN_CONSENT } from './pdn-consent'
import { CROSS_BORDER } from './cross-border'

export type { LegalDocument, LegalBlock } from './types'

/**
 * Редакция пакета правовых документов.
 *
 * Записывается в user_consents вместе с согласием пользователя. Если значение
 * изменилось, ранее данные согласия считаются относящимися к прошлой редакции,
 * и пользователю показывается форма повторного принятия (см. lib/consent.ts).
 *
 * Поднимать ТОЛЬКО при существенном изменении текста документов — опечатки
 * и правки оформления новой редакцией не являются.
 */
export const LEGAL_VERSION = '2026-08-03'

/** Порядок важен: в нём документы выводятся в футере и на странице /legal. */
export const LEGAL_DOCUMENTS: LegalDocument[] = [
  OFFER,
  TERMS,
  PRIVACY,
  PDN_CONSENT,
  CROSS_BORDER,
]

export function getLegalDocument(slug: string): LegalDocument | undefined {
  return LEGAL_DOCUMENTS.find((doc) => doc.slug === slug)
}

export { OFFER, TERMS, PRIVACY, PDN_CONSENT, CROSS_BORDER }
