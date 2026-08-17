import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== 'production'

// Content-Security-Policy.
// Nonce/strict-dynamic не используем: страницы рендерятся статически, nonce им
// не проставляется, и strict-dynamic заблокировал бы их bootstrap-скрипты.
// Поэтому script-src 'self' + 'unsafe-inline' (внешние вредоносные скрипты
// заблокированы; inline-скрипты из AI-HTML вырезаются санитайзером отдельно).
// В dev добавляем 'unsafe-eval' — нужно для HMR/React Refresh.
const csp = [
  `default-src 'self'`,
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  `style-src 'self' 'unsafe-inline'`,
  `img-src 'self' data: blob:`,
  `font-src 'self' data:`,
  `connect-src 'self'`,
  `object-src 'none'`,
  `base-uri 'self'`,
  `form-action 'self'`,
  `frame-ancestors 'none'`,
  ...(isDev ? [] : ['upgrade-insecure-requests']),
].join('; ')

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false, // не раскрываем стек через X-Powered-By
  // instrumentation.ts — файловый логгер (logs/app.log, logs/error.log)
  // Ошибки типов валят сборку осознанно: раньше стояло ignoreBuildErrors и
  // код с обращениями к несуществующим полям БД доезжал до прода.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          // Принудительный HTTPS на 2 года + поддомены
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          // Запрет встраивания в iframe (защита от кликджекинга)
          { key: 'X-Frame-Options', value: 'DENY' },
          // Запрет MIME-sniffing
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // Не утекать полный URL в Referer на сторонние сайты
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Отключаем доступ к чувствительным API браузера
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          // Защита от XSS/инъекций (defense-in-depth)
          { key: 'Content-Security-Policy', value: csp },
        ],
      },
    ]
  },
  transpilePackages: [
    'react-markdown',
    'remark-parse',
    'remark-rehype',
    'unified',
    'bail',
    'is-plain-obj',
    'trough',
    'vfile',
    'vfile-message',
    'unist-util-stringify-position',
    'mdast-util-from-markdown',
    'mdast-util-to-string',
    'mdast-util-to-hast',
    'mdast-util-definitions',
    'micromark',
    'micromark-core-commonmark',
    'micromark-factory-destination',
    'micromark-factory-label',
    'micromark-factory-space',
    'micromark-factory-title',
    'micromark-factory-whitespace',
    'micromark-util-character',
    'micromark-util-chunked',
    'micromark-util-classify-character',
    'micromark-util-combine-extensions',
    'micromark-util-decode-numeric-character-reference',
    'micromark-util-decode-string',
    'micromark-util-encode',
    'micromark-util-html-tag-name',
    'micromark-util-normalize-identifier',
    'micromark-util-resolve-all',
    'micromark-util-sanitize-uri',
    'micromark-util-subtokenize',
    'micromark-util-symbol',
    'micromark-util-types',
    'decode-named-character-reference',
    'character-entities',
    'hast-util-to-jsx-runtime',
    'hast-util-whitespace',
    'property-information',
    'space-separated-tokens',
    'comma-separated-tokens',
    'trim-lines',
    'unist-util-is',
    'unist-util-visit',
    'unist-util-visit-parents',
    'unist-util-position',
    'estree-util-is-identifier-name',
  ],
};

export default nextConfig;
