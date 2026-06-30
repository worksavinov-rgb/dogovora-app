import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false, // не раскрываем стек через X-Powered-By
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
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
