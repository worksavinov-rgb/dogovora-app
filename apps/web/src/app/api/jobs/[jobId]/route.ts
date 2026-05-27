import { NextRequest, NextResponse } from 'next/server'
import { getUserId } from '@/lib/api-auth'
import { getGenerateQueue } from '@/lib/queue'

type Params = { params: Promise<{ jobId: string }> }

// GET /api/jobs/:jobId — статус фоновой задачи (polling)
export async function GET(req: NextRequest, { params }: Params) {
  const userId = getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { jobId } = await params
  const queue = getGenerateQueue()
  const job = await queue.getJob(jobId)

  if (!job) return NextResponse.json({ error: 'Job not found' }, { status: 404 })

  const state = await job.getState()  // 'waiting' | 'active' | 'completed' | 'failed' | 'delayed'
  const progress = job.progress as number ?? 0

  return NextResponse.json({
    jobId,
    state,
    progress,
    result: state === 'completed' ? job.returnvalue : null,
    failedReason: state === 'failed' ? job.failedReason : null,
  })
}
