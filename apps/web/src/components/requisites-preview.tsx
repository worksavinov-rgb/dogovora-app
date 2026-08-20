'use client'

// Превью блока реквизитов — показывает как данные встанут в договор

export interface RequisitesData {
  type: string          // SOLE_PROPRIETOR | COMPANY | ZAO | PAO | ANO | INDIVIDUAL | SELF_EMPLOYED
  name: string
  inn?: string | null
  kpp?: string | null
  ogrn?: string | null
  ogrnDate?: string | null
  legalAddress?: string | null
  actualAddress?: string | null
  passportSeries?: string | null
  passportNumber?: string | null
  passportIssuedBy?: string | null
  passportIssueDate?: string | null
  passportDeptCode?: string | null
  npdRegisteredDate?: string | null
  email?: string | null
  signatorName?: string | null
  signatorPosition?: string | null
  bankName?: string | null
  bik?: string | null
  checkingAccount?: string | null
  correspondentAccount?: string | null
}

function ReqRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null
  return (
    <div className="flex gap-[4px] text-[12px] leading-[1.6]">
      <span className="text-[var(--ink-4)] shrink-0">{label}:</span>
      <span className="text-[var(--ink)] break-all" style={{ fontFamily: 'var(--font-mono)' }}>{value}</span>
    </div>
  )
}

export function RequisitesPreview({ data, role }: { data: RequisitesData; role?: string }) {
  const isIP = data.type === 'SOLE_PROPRIETOR'
  const isIndividual = data.type === 'INDIVIDUAL'
  const isSelfEmployed = data.type === 'SELF_EMPLOYED'
  const isPerson = isIndividual || isSelfEmployed

  const hasAnyData = data.name || data.inn || data.ogrn || data.legalAddress || data.bankName || data.passportSeries

  if (!hasAnyData) {
    return (
      <div className="flex flex-col items-center justify-center gap-[8px] py-[32px] text-center">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--ink-4)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18" /><path d="M9 21V9" />
        </svg>
        <p className="text-[13px] text-[var(--ink-3)]">Заполните реквизиты слева — здесь появится превью</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-[10px]">
      {role && (
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--ink-4)]">{role}</p>
      )}

      {/* Название / ФИО */}
      <p className="text-[13px] font-semibold text-[var(--ink)] leading-[1.4]">{data.name || '—'}</p>

      {/* Адрес */}
      {data.legalAddress && (
        <p className="text-[12px] text-[var(--ink-3)] leading-[1.5]">
          <span className="text-[var(--ink-4)]">Адрес: </span>
          {data.legalAddress}
        </p>
      )}

      {/* Реквизиты */}
      <div className="flex flex-col gap-[1px]">
        <ReqRow label="ИНН" value={data.inn} />
        {!isIP && !isPerson && <ReqRow label="КПП" value={data.kpp} />}
        {isIP
          ? <ReqRow label="ОГРНИП" value={data.ogrn} />
          : !isPerson && <ReqRow label="ОГРН" value={data.ogrn} />
        }
        {isPerson && (
          <ReqRow label="Паспорт" value={[data.passportSeries, data.passportNumber].filter(Boolean).join(' № ') || null} />
        )}
        {isPerson && (
          <ReqRow label="Выдан" value={[data.passportIssuedBy, data.passportIssueDate].filter(Boolean).join(', ') || null} />
        )}
        {isSelfEmployed && <ReqRow label="Статус" value="Плательщик НПД" />}
        <ReqRow label="Р/счёт" value={data.checkingAccount} />
        <ReqRow label="К/счёт" value={data.correspondentAccount} />
        <ReqRow label="Банк" value={data.bankName} />
        <ReqRow label="БИК" value={data.bik} />
        {(isIP || isPerson) && <ReqRow label="E-mail" value={data.email} />}
      </div>

      {/* Подпись */}
      <div className="mt-[6px] pt-[8px] border-t border-[var(--line-2)]">
        {isIP ? (
          <div className="flex flex-col gap-[2px]">
            <p className="text-[12px] text-[var(--ink)]">
              ИП {data.name || '________________'}
            </p>
            <div className="flex items-end gap-[8px] mt-[2px]">
              <p className="text-[12px] text-[var(--ink-4)]">
                {data.signatorName
                  ? data.signatorName.split(' ').map((w, i) => i === 0 ? w : w[0] + '.').join(' ')
                  : '___________'
                }
              </p>
              <div className="flex-1 border-b border-dashed border-[var(--line-strong)] mb-[3px]" />
            </div>
          </div>
        ) : isPerson ? (
          <div className="flex items-end gap-[8px]">
            <p className="text-[12px] text-[var(--ink-4)]">
              {data.signatorName
                ? data.signatorName.split(' ').map((w, i) => i === 0 ? w : w[0] + '.').join(' ')
                : (data.name || '___________')
              }
            </p>
            <div className="flex-1 border-b border-dashed border-[var(--line-strong)] mb-[3px]" />
          </div>
        ) : (
          <div className="flex flex-col gap-[2px]">
            <p className="text-[12px] text-[var(--ink-4)]">
              {data.signatorPosition || 'Генеральный директор'}{' '}
              {data.signatorName
                ? data.signatorName.split(' ').map((w, i) => i === 0 ? w : w[0] + '.').join(' ')
                : '________________'
              }
            </p>
            <div className="flex items-end gap-[8px] mt-[2px]">
              <p className="text-[12px] text-[var(--ink-4)] shrink-0">Подпись:</p>
              <div className="flex-1 border-b border-dashed border-[var(--line-strong)] mb-[3px]" />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
