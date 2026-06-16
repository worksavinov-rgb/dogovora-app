import type { AIProvider } from './types'
import { mockProvider } from './mock-provider'
import { gigachatProvider } from './gigachat-provider'

const codexProviderProxy: AIProvider = {
  async *chat(messages, settings, documentText) {
    const { codexProvider } = await import('./codex-provider')
    yield* codexProvider.chat(messages, settings, documentText)
  },

  async *editDocument(documentText, instruction, settings) {
    const { codexProvider } = await import('./codex-provider')
    yield* codexProvider.editDocument(documentText, instruction, settings)
  },

  async review(documentText, settings) {
    const { codexProvider } = await import('./codex-provider')
    return codexProvider.review(documentText, settings)
  },

  async *generate(description, counterpartyName, settings) {
    const { codexProvider } = await import('./codex-provider')
    yield* codexProvider.generate(description, counterpartyName, settings)
  },

  async extractParties(documentText) {
    const { codexProvider } = await import('./codex-provider')
    return codexProvider.extractParties(documentText)
  },
}

export function getAIProvider(): AIProvider {
  const provider = (process.env['AI_PROVIDER'] ?? 'mock').toLowerCase()

  if (provider === 'gigachat') return gigachatProvider
  if (provider === 'codex') return codexProviderProxy

  return mockProvider
}
