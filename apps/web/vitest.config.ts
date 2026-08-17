// Конфиг vitest для узловых (node) тестов конвейера обработки документов.
// Без jsdom — тестируем чистые функции и генерацию DOCX, DOM не нужен.
import { defineConfig } from 'vitest/config'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      // Те же алиасы, что в tsconfig.json приложения
      '@': path.resolve(dirname, './src'),
      '@shared': path.resolve(dirname, '../../packages/shared/src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
  },
})
