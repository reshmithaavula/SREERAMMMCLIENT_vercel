import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('--- ENHANCING USER PORTFOLIO ---');

    // 1. Find the first user or create a default if none exists
    let user = await prisma.user.findFirst();

    if (!user) {
        console.log('No user found, creating a default user...');
        user = await prisma.user.create({
            data: {
                name: 'StockTrack User',
                email: 'user@example.com',
                role: 'user'
            }
        });
    }

    console.log(`Target User: ${user.name} (${user.email})`);

    // 2. Define a rich set of positions
    const newPositions = [
        { ticker: 'AAPL', avgCost: 175.50, shares: 10 },
        { ticker: 'TSLA', avgCost: 240.20, shares: 15 },
        { ticker: 'NVDA', avgCost: 450.00, shares: 25 },
        { ticker: 'MSFT', avgCost: 330.10, shares: 8 },
        { ticker: 'AMZN', avgCost: 145.60, shares: 12 },
        { ticker: 'META', avgCost: 310.25, shares: 20 },
        { ticker: 'NFLX', avgCost: 420.00, shares: 5 },
        { ticker: 'GOOGL', avgCost: 135.50, shares: 18 },
        { ticker: 'PLTR', avgCost: 16.20, shares: 100 },
        { ticker: 'AMD', avgCost: 110.40, shares: 30 },
        { ticker: 'MARA', avgCost: 12.50, shares: 50 },
        { ticker: 'COIN', avgCost: 85.00, shares: 15 },
    ];

    console.log(`Adding ${newPositions.length} positions...`);

    // 3. Populate holdings
    for (const pos of newPositions) {
        await prisma.portfolioHolding.create({
            data: {
                ticker: pos.ticker,
                avgCost: pos.avgCost,
                shares: pos.shares,
                userId: user.id
            }
        });
    }

    console.log('Portfolio populated successfully.');

    // 4. Verify
    const finalCount = await prisma.portfolioHolding.count({ where: { userId: user.id } });
    console.log(`Total positions for user: ${finalCount}`);
}

main()
    .catch(e => console.error(e))
    .finally(() => prisma.$disconnect());
