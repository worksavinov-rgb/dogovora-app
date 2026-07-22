import { NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { getUserId } from '@/lib/api-auth'

export async function requireAdmin(req: NextRequest): Promise<{ userId: string } | null> {
  const userId = await getUserId(req)
  if (!userId) return null
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } })
  if (!user?.isAdmin) return null
  return { userId }
}
