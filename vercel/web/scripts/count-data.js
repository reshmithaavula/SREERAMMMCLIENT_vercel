const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const sessionCount = await prisma.session.count();
    const userCount = await prisma.user.count();

    console.log(`Current Sessions: ${sessionCount}`);
    console.log(`Current Users: ${userCount}`);
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
