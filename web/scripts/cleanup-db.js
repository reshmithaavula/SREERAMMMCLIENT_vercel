const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    // 1. Delete all sessions and accounts first (foreign key constraints)
    const sessions = await prisma.session.deleteMany({});
    const accounts = await prisma.account.deleteMany({});

    // 2. Delete all users EXCEPT the main admin and Jaswanth accounts
    const users = await prisma.user.deleteMany({
        where: {
            NOT: [
                { email: 'admin@stocktrack.com' },
                { name: { contains: 'jaswanth', mode: 'insensitive' } }
            ]
        }
    });

    console.log(`Cleared ${sessions.count} sessions.`);
    console.log(`Cleared ${accounts.count} accounts.`);
    console.log(`Deleted ${users.count} test users.`);
    console.log('Main Admin and JASWANTH accounts have been preserved.');
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
