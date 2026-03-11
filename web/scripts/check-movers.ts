import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function check() {
    const movers = await prisma.marketMover.findMany({
        take: 5,
        orderBy: { updatedAt: 'desc' }
    });
    console.log(JSON.stringify(movers, null, 2));
}

check().catch(console.error).finally(() => prisma.$disconnect());
