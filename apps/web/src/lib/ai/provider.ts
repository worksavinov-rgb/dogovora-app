import type { AIProvider } from './types'
import { mockProvider } from './mock-provider'
import { gigachatProvider } from './gigachat-provider'

export function getAIProvider(): AIProvider {
  const provider = (process.env['AI_PROVIDER'] ?? 'mock').toLowerCase()

  if (provider === 'gigachat') return gigachatProvider

  return mockProvider
}

