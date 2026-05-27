/**
 * Валидация реквизитов: ИНН, ОГРН, БИК, расчётный счёт
 */

// ─── ИНН ─────────────────────────────────────────────────────────────────────

function checkInnDigit(inn: string, coefficients: number[]): boolean {
  const n = coefficients.reduce((sum, c, i) => sum + c * parseInt(inn[i]), 0)
  return (n % 11 % 10) === parseInt(inn[coefficients.length])
}

export function validateInn(inn: string): string | null {
  if (!inn) return null
  if (!/^\d+$/.test(inn)) return 'ИНН должен содержать только цифры'

  if (inn.length === 10) {
    // Юридическое лицо
    if (!checkInnDigit(inn, [2, 4, 10, 3, 5, 9, 4, 6, 8])) {
      return 'Неверная контрольная сумма ИНН'
    }
    return null
  }

  if (inn.length === 12) {
    // Физическое лицо / ИП
    if (
      !checkInnDigit(inn, [7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) ||
      !checkInnDigit(inn, [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8])
    ) {
      return 'Неверная контрольная сумма ИНН'
    }
    return null
  }

  return 'ИНН должен содержать 10 или 12 цифр'
}

// ─── ОГРН / ОГРНИП ───────────────────────────────────────────────────────────

/** Остаток от деления большого числа (строка) на делитель */
function bigMod(numStr: string, divisor: number): number {
  let remainder = 0
  for (const ch of numStr) {
    remainder = (remainder * 10 + parseInt(ch)) % divisor
  }
  return remainder
}

export function validateOgrn(ogrn: string, type: 'company' | 'ip'): string | null {
  if (!ogrn) return null
  if (!/^\d+$/.test(ogrn)) return 'ОГРН должен содержать только цифры'

  if (type === 'company') {
    if (ogrn.length !== 13) return 'ОГРН должен содержать 13 цифр'
    const n = bigMod(ogrn.slice(0, 12), 11)
    const check = n === 10 ? 0 : n
    if (check !== parseInt(ogrn[12])) return 'Неверная контрольная сумма ОГРН'
  } else {
    if (ogrn.length !== 15) return 'ОГРНИП должен содержать 15 цифр'
    const n = bigMod(ogrn.slice(0, 14), 13)
    const check = n >= 10 ? n % 10 : n
    if (check !== parseInt(ogrn[14])) return 'Неверная контрольная сумма ОГРНИП'
  }

  return null
}

// ─── БИК ─────────────────────────────────────────────────────────────────────

export function validateBik(bik: string): string | null {
  if (!bik) return null
  if (!/^\d{9}$/.test(bik)) return 'БИК должен содержать 9 цифр'
  if (!bik.startsWith('04')) return 'БИК российского банка начинается с 04'
  return null
}

// ─── Расчётный счёт ───────────────────────────────────────────────────────────

export function validateCheckingAccount(account: string, bik: string): string | null {
  if (!account) return null
  if (!/^\d{20}$/.test(account)) return 'Расчётный счёт должен содержать 20 цифр'

  if (bik.length === 9) {
    // Контрольная сумма: ключ = бик[6..8] + счёт
    const key = bik.slice(6, 9) + account
    const coefficients = [7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1, 3, 7, 1]
    const sum = coefficients.reduce((s, c, i) => s + c * parseInt(key[i]), 0)
    if (sum % 10 !== 0) return 'Неверная контрольная сумма расчётного счёта'
  }

  return null
}

// ─── КПП ─────────────────────────────────────────────────────────────────────

export function validateKpp(kpp: string): string | null {
  if (!kpp) return null
  if (!/^\d{9}$/.test(kpp)) return 'КПП должен содержать 9 цифр'
  return null
}
