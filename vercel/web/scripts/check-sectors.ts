import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('--- WATCHLIST CATEGORIES ---');
    const categories = await prisma.watchlist.findMany({
        distinct: ['category'],
        select: { category: true }
    });
    console.log(categories);

    console.log('\n--- SAMPLE WATCHLIST DATA ---');
    const samples = await prisma.watchlist.findMany({
        take: 5
    });
    console.log(samples);

    console.log('\n--- SECTOR ANALYSIS (LATEST) ---');
    const all = await prisma.watchlist.findMany();
    const sectorGroups: any = {};
    all.forEach(w => {
        const name = w.category || 'General';
        const change = (w as any).changePercent || 0;
        if (!sectorGroups[name]) sectorGroups[name] = { total: 0, count: 0 };
        sectorGroups[name].total += change;
        sectorGroups[name].count += 1;
    });

    const results = Object.entries(sectorGroups).map(([name, stats]: any) => ({
        name,
        avg: stats.total / stats.count
    }));
    console.log(results);
}

main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
