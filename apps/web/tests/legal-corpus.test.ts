import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { LEGAL_EMBEDDING_DIM, buildNormPath, buildFtsInput } from '../src/lib/legal/corpus'
import { hashEmbedder } from '../src/lib/legal/embeddings'

describe('legal corpus helpers', () => {
  it('размерность эмбеддинга совпадает с колонкой vector(N) в миграции', () => {
    // Расхождение здесь = отказ вставки в БД, поэтому сверяем с реальным SQL,
    // а не с самой константой.
    const sql = readFileSync(
      join(__dirname, '../prisma/migrations/20260824130000_add_legal_base/migration.sql'),
      'utf-8',
    )
    const m = sql.match(/"embedding"\s+vector\((\d+)\)/)
    expect(m).not.toBeNull()
    expect(Number(m![1])).toBe(LEGAL_EMBEDDING_DIM)
  })

  it('эмбеддер выдаёт вектор ровно той длины, которую ждёт БД', async () => {
    const [v] = await hashEmbedder.embed(['проверка размерности'])
    expect(v).toHaveLength(LEGAL_EMBEDDING_DIM)
  })

  it('строит путь нормы со статьёй и пунктом', () => {
    expect(buildNormPath('454', '1')).toBe('ст. 454 п. 1')
  })

  it('строит путь нормы без пункта', () => {
    expect(buildNormPath('454', null)).toBe('ст. 454')
  })

  it('склеивает заголовок и текст для FTS с одним пробелом', () => {
    expect(buildFtsInput('Договор', 'купли-продажи')).toBe('Договор купли-продажи')
    expect(buildFtsInput('', 'только текст')).toBe('только текст')
  })
})
