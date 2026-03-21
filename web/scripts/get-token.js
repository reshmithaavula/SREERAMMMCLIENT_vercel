const { PrismaClient } = require('@prisma/client');

// Force DATABASE_URL specifically for this test script
// DATABASE_URL should be provided by environment or .env
if (!process.env.DATABASE_URL) {
    require('dotenv').config();
}

const prisma = new PrismaClient();

async function main() {
    const email = 'flow-test-local@example.com';
    const user = await prisma.user.findUnique({
        where: { email: email.toLowerCase() }
    });
    if (user) {
        console.log('---TOKEN_START---');
        console.log(user.approvalToken);
        console.log('---TOKEN_END---');
    } else {
        console.log('User not found');
    }
}

main()
    .catch(e => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
