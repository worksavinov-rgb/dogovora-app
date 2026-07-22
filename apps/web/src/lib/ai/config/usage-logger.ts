import { prisma } from '@/lib/db'
import type { AIUsageMeta, AIUsageResult } from './types'

export async function logAIUsage(meta: AIUsageMeta, result: AIUsageResult): Promise<void> {
  if (!result.operatorId && result.operatorSlug === 'mock') return

  try {
    let operatorId = result.operatorId
    if (!operatorId) {
      const op = await prisma.aIOperator.findUnique({ where: { slug: result.operatorSlug } })
      operatorId = op?.id
    }
    if (!operatorId) return

    await prisma.aIUsageLog.create({
      data: {
        operatorId,
        task: meta.task,
        modelId: result.modelId,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        totalTokens: result.totalTokens,
        costRub: result.costRub ?? null,
        durationMs: result.durationMs,
        versionId: meta.versionId ?? null,
        userId: meta.userId ?? null,
      },
    })
  } catch (err) {
    console.error('[AIUsageLog] failed to write:', err)
  }
}

export async function getUsageSummary(period: 'day' | 'month' | 'all' = 'month') {
  const now = new Date()
  let since: Date | undefined
  if (period === 'day') {
    since = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  } else if (period === 'month') {
    since = new Date(now.getFullYear(), now.getMonth(), 1)
  }

  const where = since ? { createdAt: { gte: since } } : {}

  const [total, byTask, byOperator, recent] = await Promise.all([
    prisma.aIUsageLog.aggregate({
      where,
      _sum: { costRub: true, totalTokens: true },
      _count: true,
    }),
    prisma.aIUsageLog.groupBy({
      by: ['task'],
      where,
      _sum: { costRub: true, totalTokens: true },
      _count: true,
    }),
    prisma.aIUsageLog.groupBy({
      by: ['operatorId'],
      where,
      _sum: { costRub: true, totalTokens: true },
      _count: true,
    }),
    prisma.aIUsageLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { operator: { select: { slug: true, name: true } } },
    }),
  ])

  return {
    totalCostRub: total._sum.costRub ?? 0,
    totalTokens: total._sum.totalTokens ?? 0,
    requestCount: total._count,
    byTask: byTask.map((r) => ({
      task: r.task,
      costRub: r._sum.costRub ?? 0,
      tokens: r._sum.totalTokens ?? 0,
      count: r._count,
    })),
    byOperator: byOperator.map((r) => ({
      operatorId: r.operatorId,
      costRub: r._sum.costRub ?? 0,
      tokens: r._sum.totalTokens ?? 0,
      count: r._count,
    })),
    recent,
  }
}
