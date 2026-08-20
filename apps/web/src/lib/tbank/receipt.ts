/**
 * Объект Receipt для облачной кассы Т-Банка (54-ФЗ). Банк по этим данным сам
 * пробивает фискальный чек. Name/Price/Amount — по одной позиции на пакет.
 */
export interface ReceiptInput {
  email: string
  label: string
  amountKopecks: number
}

export function buildReceipt(input: ReceiptInput): Record<string, unknown> {
  const taxation = process.env.TBANK_TAXATION || 'usn_income'
  const vat = process.env.TBANK_VAT || 'none'
  return {
    Email: input.email,
    Taxation: taxation,
    Items: [
      {
        Name: `Токены Догодок — ${input.label}`.slice(0, 128),
        Price: input.amountKopecks,
        Quantity: 1,
        Amount: input.amountKopecks,
        Tax: vat,
        PaymentMethod: 'full_payment',
        PaymentObject: 'service',
      },
    ],
  }
}
