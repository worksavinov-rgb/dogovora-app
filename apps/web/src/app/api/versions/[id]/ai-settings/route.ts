import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'

type Params = { params: Promise<{ id: string }> }

const aiSettingsSchema = z.object({
  description: z.string().max(1000).optional(),
  protectionLevel: z.number().min(0).max(100).optional(),
  targetSize: z.number().min(100).max(100000).optional(),
  customInstruction: z.string().max(1000).optional(),
})

// PATCH /api/versions/:id/ai-settings
// Обновляет только настройки ИИ без создания новой версии.
// Используется при изменении параметров через панель "Настройки" на рабочем экране.
export async function PATCH(req: NextRequest, { params }: Params) {
  const userId = await getUserId(req)
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const version = await prisma.version.findFirst({
    where: { id, document: { userId } },
  })
  if (!version) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const body = await req.json()
  let data: z.infer<typeof aiSettingsSchema>
  try {
    data = aiSettingsSchema.parse(body)
  } catch (err: unknown) {
    if (err instanceof z.ZodError) return NextResponse.json({ error: err.issues[0]?.message }, { status: 400 })
    throw err
  }

  // Мержим новые настройки со старыми
  const oldSettings = (version.aiSettings as Record<string, any>) || {}
  const updatedSettings = {
    ...oldSettings,
    ...data,
  }

  const updated = await prisma.version.update({
    where: { id },
    data: { aiSettings: updatedSettings },
  })

  return NextResponse.json({ aiSettings: updated.aiSettings })
}
