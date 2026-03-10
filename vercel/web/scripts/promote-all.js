const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const result = await prisma.user.updateMany({
        data: {
            role: 'owner'
        }
    });
    console.log(`Successfully promoted ${result.count} users to owner.`);
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
