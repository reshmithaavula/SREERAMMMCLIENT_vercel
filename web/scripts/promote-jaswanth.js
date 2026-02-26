const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const result = await prisma.user.updateMany({
        where: {
            name: {
                contains: 'jaswanth',
                mode: 'insensitive'
            }
        },
        data: {
            role: 'owner'
        }
    });
    console.log(`Promoted ${result.count} jaswanth users to owner.`);
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
