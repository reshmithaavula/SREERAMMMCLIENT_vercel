const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function wipeAllUsers() {
    try {
        console.log('⚠️  Starting full user data wipe...');

        // Delete in order to satisfy foreign key constraints
        console.log('Cleaning up sessions...');
        await prisma.session.deleteMany({});

        console.log('Cleaning up accounts...');
        await prisma.account.deleteMany({});

        console.log('Cleaning up portfolio holdings...');
        await prisma.portfolioHolding.deleteMany({});

        console.log('Cleaning up users...');
        const result = await prisma.user.deleteMany({});

        console.log(`✅ Success! Wiped ${result.count} users and all associated data.`);
        console.log('The system is now fresh for new registrations.');

    } catch (error) {
        console.error('❌ Error wiping data:', error);
    } finally {
        await prisma.$disconnect();
    }
}

wipeAllUsers();
