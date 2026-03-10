const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    // Delete all accounts and sessions (though we use JWT, let's keep it clean)
    await prisma.account.deleteMany({});
    await prisma.session.deleteMany({});

    // Delete all users EXCEPT the primary admin
    const result = await prisma.user.deleteMany({
        where: {
            NOT: {
                email: 'admin@stocktrack.com'
            }
        }
    });

    console.log(`Successfully deleted ${result.count} test accounts.`);
    console.log('Only the primary admin (admin@stocktrack.com) remains.');
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
