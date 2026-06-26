import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const PROMO_CODES = [
  'BETA-A1X2',
  'BETA-B3Y4',
  'BETA-C5Z6',
  'BETA-D7W8',
  'BETA-E9V0',
  'BETA-F2U1',
  'BETA-G4T3',
  'BETA-H6S5',
  'BETA-I8R7',
  'BETA-J0Q9',
  'BETA-K1P2',
  'BETA-L3N4',
  'BETA-M5M6',
  'BETA-N7L8',
  'BETA-O9K0',
  'BETA-P2J1',
  'BETA-Q4H3',
  'BETA-R6G5',
  'BETA-S8F7',
  'BETA-T0E9',
]

async function main() {
  console.log('Seeding promo codes...')

  for (const code of PROMO_CODES) {
    await prisma.promoCode.upsert({
      where: { code },
      update: {},
      create: { code },
    })
  }

  console.log(`Created ${PROMO_CODES.length} promo codes`)
  console.log('Codes:', PROMO_CODES.join(', '))
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
