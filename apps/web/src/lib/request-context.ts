import { getRequestIdFromHeaders, runWithRequestContext } from '@/lib/logger'

/** request_id из заголовка (проставляет middleware). */
export function getRequestId(req: Request): string {
  return getRequestIdFromHeaders(req.headers) || crypto.randomUUID()
}

/** Обернуть обработчик API с AsyncLocalStorage request_id. */
export function withRequestLogContext<T>(req: Request, fn: () => T): T {
  return runWithRequestContext({ request_id: getRequestId(req) }, fn)
}
