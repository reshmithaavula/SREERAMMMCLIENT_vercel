const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log('Initiating total data purge...');

    // 1. Delete dependent data first
    const sessions = await prisma.session.deleteMany({});
    const accounts = await prisma.account.deleteMany({});

    // 2. Delete ALL users
    const users = await prisma.user.deleteMany({});

    console.log('--- PURGE RESULTS ---');
    console.log(`- Sessions deleted: ${sessions.count}`);
    console.log(`- Accounts deleted: ${accounts.count}`);
    console.log(`- Users deleted: ${users.count}`);
    console.log('---------------------');
    console.log('All login data has been completely wiped.');
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
