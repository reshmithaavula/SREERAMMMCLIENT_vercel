import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
    const admin = await prisma.user.findUnique({
        where: { email: 'admin@stocktrack.com' }
    });
    console.log('ADMIN_USER_IN_DB:', admin);
}

main().catch(console.error).finally(() => prisma.$disconnect());
