import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const movers = await prisma.marketMover.findMany({
        take: 10
    });
    console.log('Sample MarketMovers:', JSON.stringify(movers, null, 2));

    const count = await prisma.marketMover.count();
    console.log(`Total count: ${count}`);

    const types = await prisma.marketMover.groupBy({
        by: ['type'],
        _count: {
            _all: true
        }
    });
    console.log('Counts by type:', JSON.stringify(types, null, 2));
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
