/**
 * Фикс-пакеты токенов для пополнения баланса. Сервер — единственный источник
 * соответствия «пакет → токены → цена». Цены (в рублях) переопределяются через
 * ENV TOKEN_PACKAGE_<ID>_RUB. Цифры — заглушки, утверждаются перед запуском.
 */
export interface TokenPackage {
  id: string
  tokens: number
  priceRub: number
  label: string
  badge?: string
}

function envRub(id: string, fallback: number): number {
  const v = Number(process.env[`TOKEN_PACKAGE_${id.toUpperCase()}_RUB`])
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback
}

export const TOKEN_PACKAGES: TokenPackage[] = [
  { id: 'start', tokens: 300, priceRub: envRub('start', 300), label: 'Старт' },
  { id: 'standard', tokens: 1000, priceRub: envRub('standard', 900), label: 'Стандарт', badge: 'Выгодно' },
  { id: 'pro', tokens: 3000, priceRub: envRub('pro', 2500), label: 'Про' },
  { id: 'max', tokens: 10000, priceRub: envRub('max', 7900), label: 'Максимум', badge: 'Лучшая цена' },
]

export function getPackage(id: string): TokenPackage | undefined {
  return TOKEN_PACKAGES.find((p) => p.id === id)
}

export function priceKopecks(pkg: TokenPackage): number {
  return Math.round(pkg.priceRub * 100)
}
