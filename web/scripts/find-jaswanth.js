const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    const users = await prisma.user.findMany({
        where: {
            name: {
                contains: 'JASWANTH'
            }
        }
    });
    console.log('--- Matching Users ---');
    users.forEach(u => {
        console.log(`ID: ${u.id} | Name: ${u.name} | Email: ${u.email} | Role: ${u.role}`);
    });
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
