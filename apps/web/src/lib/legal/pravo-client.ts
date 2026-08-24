// Клиент официального API опубликования pravo.gov.ru (только чтение).
// fetchImpl внедряется ради тестов; в проде — обёртка над глобальным fetch с таймаутом.

export const PRAVO_BASE_URL = 'http://publication.pravo.gov.ru'
export const DOC_TYPE_FEDERAL_LAW = '82a8bf1c-3bc7-47ed-827f-7affd43a7f27'

export type FetchLike = (url: string) => Promise<{
  ok: boolean
  status: number
  json: () => Promise<unknown>
  text: () => Promise<string>
}>

export interface DocumentType {
  id: string
  name: string
  weight: number
}

export interface PravoDoc {
  eoNumber: string
  complexName: string
  name: string
  number: string
  documentDate: string
  documentTypeId: string
  pdfFileLength: number | null
  pagesCount: number | null
  id: string
}

export interface DocumentsPage {
  items: PravoDoc[]
  itemsTotalCount: number
  pagesTotalCount: number
  currentPage: number
}

export interface SearchParams {
  documentTypes?: string[]
  name?: string
  number?: string
  block?: string
  documentDateFrom?: string
  publishDateFrom?: string
  pageSize?: 100 | 200
  index?: number
}

const DEFAULT_TIMEOUT_MS = 30_000

const defaultFetch: FetchLike = (url) =>
  fetch(url, { signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS), headers: { Accept: 'application/json' } })

async function getJson(url: string, fetchImpl: FetchLike): Promise<unknown> {
  const res = await fetchImpl(url)
  if (!res.ok) throw new Error(`pravo.gov.ru ${res.status}: ${url}`)
  return res.json()
}

export async function listDocumentTypes(fetchImpl: FetchLike = defaultFetch): Promise<DocumentType[]> {
  const data = await getJson(`${PRAVO_BASE_URL}/api/DocumentTypes`, fetchImpl)
  const arr = Array.isArray(data) ? data : []
  return arr.map((t) => ({
    id: String((t as Record<string, unknown>).id ?? ''),
    name: String((t as Record<string, unknown>).name ?? ''),
    weight: Number((t as Record<string, unknown>).weight ?? 0),
  }))
}

function buildDocumentsUrl(params: SearchParams): string {
  const q = new URLSearchParams()
  for (const t of params.documentTypes ?? []) q.append('DocumentTypes', t)
  if (params.name) q.set('Name', params.name)
  if (params.number) q.set('Number', params.number)
  if (params.block) q.set('Block', params.block)
  if (params.documentDateFrom) q.set('DocumentDateFrom', params.documentDateFrom)
  if (params.publishDateFrom) q.set('PublishDateFrom', params.publishDateFrom)
  q.set('PageSize', String(params.pageSize ?? 100))
  q.set('Index', String(params.index ?? 1))
  return `${PRAVO_BASE_URL}/api/Documents?${q.toString()}`
}

function toDoc(raw: unknown): PravoDoc {
  const r = raw as Record<string, unknown>
  return {
    eoNumber: String(r.eoNumber ?? ''),
    complexName: String(r.complexName ?? ''),
    name: String(r.name ?? ''),
    number: String(r.number ?? ''),
    documentDate: String(r.documentDate ?? ''),
    documentTypeId: String(r.documentTypeId ?? ''),
    pdfFileLength: r.pdfFileLength == null ? null : Number(r.pdfFileLength),
    pagesCount: r.pagesCount == null ? null : Number(r.pagesCount),
    id: String(r.id ?? ''),
  }
}

export async function searchDocuments(
  params: SearchParams,
  fetchImpl: FetchLike = defaultFetch,
): Promise<DocumentsPage> {
  const data = (await getJson(buildDocumentsUrl(params), fetchImpl)) as Record<string, unknown>
  const items = Array.isArray(data.items) ? data.items.map(toDoc) : []
  return {
    items,
    itemsTotalCount: Number(data.itemsTotalCount ?? items.length),
    pagesTotalCount: Number(data.pagesTotalCount ?? 1),
    currentPage: Number(data.currentPage ?? params.index ?? 1),
  }
}

export async function hasDocumentText(
  eoNumber: string,
  fetchImpl: FetchLike = defaultFetch,
): Promise<boolean> {
  const res = await fetchImpl(`${PRAVO_BASE_URL}/api/DocumentText?eonumber=${encodeURIComponent(eoNumber)}`)
  if (!res.ok) throw new Error(`pravo.gov.ru ${res.status}: DocumentText ${eoNumber}`)
  const body = (await res.text()).trim().toLowerCase()
  return body === 'true'
}
