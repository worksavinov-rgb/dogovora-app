// Абстракция эмбеддера. hashEmbedder — детерминированный локальный вектор
// (без сети): для тестов и как fallback, если эмбеддинг-оператор не настроен.
// Реальный эмбеддер оператора добавляется в Плане 3 (задача `embed` в lib/ai).

import { LEGAL_EMBEDDING_DIM } from './corpus'

export interface EmbeddingClient {
  embed(texts: string[]): Promise<number[][]>
}

/** FNV-1a хеш слова → индекс корзины. */
function bucket(word: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < word.length; i++) {
    h ^= word.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return Math.abs(h) % LEGAL_EMBEDDING_DIM
}

function embedOne(text: string): number[] {
  const vec = new Array(LEGAL_EMBEDDING_DIM).fill(0)
  const words = text.toLowerCase().split(/[^a-zа-я0-9ё]+/i).filter(Boolean)
  for (const w of words) vec[bucket(w)] += 1
  const norm = Math.sqrt(vec.reduce((s, x) => s + x * x, 0)) || 1
  return vec.map((x) => x / norm)
}

export const hashEmbedder: EmbeddingClient = {
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(embedOne)
  },
}
