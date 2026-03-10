import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('Populating additional categories...');

    const additionalStocks = [
        { ticker: 'NVDA', category: 'AI_Chips' },
        { ticker: 'AMD', category: 'AI_Chips' },
        { ticker: 'MSFT', category: 'Software_AI' },
        { ticker: 'GOOGL', category: 'Software_AI' },
        { ticker: 'XOM', category: 'Energy' },
        { ticker: 'CVX', category: 'Energy' },
        { ticker: 'MRNA', category: 'BioTech' },
        { ticker: 'PFE', category: 'BioTech' },
        { ticker: 'TSLA', category: 'EV' },
        { ticker: 'RIVN', category: 'EV' },
    ];

    for (const stock of additionalStocks) {
        await prisma.watchlist.upsert({
            where: { ticker: stock.ticker },
            update: { category: stock.category },
            create: { ticker: stock.ticker, category: stock.category }
        });
    }

    console.log('Categories populated successfully.');
}

main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
