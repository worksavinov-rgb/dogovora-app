// Синий значок Microsoft Word для кнопок и карточек загрузки .docx
export function WordIcon({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0"
      aria-hidden="true"
    >
      <rect width="16" height="16" rx="3" fill="#2B579A" />
      <text
        x="8"
        y="11.5"
        textAnchor="middle"
        fontSize="9.5"
        fontWeight="700"
        fill="#ffffff"
        fontFamily="Arial, sans-serif"
      >
        W
      </text>
    </svg>
  )
}
