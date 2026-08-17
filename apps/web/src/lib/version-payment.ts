// Единый ответ на вопрос «оплачена ли версия».
//
// Раньше это считалось тремя способами в разных местах (purchase != null,
// status === 'PAID', их OR) — и статус с фактом покупки могли расходиться:
// status правится руками через PATCH /status, purchase создаётся транзакцией
// покупки. Истина: версия оплачена, если есть Purchase ИЛИ статус PAID/SIGNED
// (SIGNED разрешён только после оплаты — это проверяет /status).

export function isVersionPaid(v: { status?: string | null; purchase?: unknown }): boolean {
  return v.purchase != null || v.status === 'PAID' || v.status === 'SIGNED'
}
