import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    console.log('--- ALL USERS ---');
    const users = await prisma.user.findMany({
        select: { id: true, name: true, email: true, role: true }
    });
    console.log(users);

    console.log('\n--- PORTFOLIO HOLDINGS ---');
    const holdings = await prisma.portfolioHolding.findMany();
    console.log(holdings);
}

main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
