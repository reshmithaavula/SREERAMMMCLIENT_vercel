const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function approveAll() {
    try {
        console.log('Searching for pending users...');
        const pendingUsers = await prisma.user.findMany({
            where: { status: 'pending' }
        });

        if (pendingUsers.length === 0) {
            console.log('No pending users found.');
            return;
        }

        console.log(`Found ${pendingUsers.length} pending users. Approving...`);

        const result = await prisma.user.updateMany({
            where: { status: 'pending' },
            data: {
                status: 'approved',
                role: 'owner', // Granting owner access as requested
                approvalToken: null
            }
        });

        console.log(`✅ Success! ${result.count} users have been approved.`);
        console.log('Emails of approved users:');
        pendingUsers.forEach(u => console.log(` - ${u.email}`));

    } catch (error) {
        console.error('❌ Error approving users:', error);
    } finally {
        await prisma.$disconnect();
    }
}

approveAll();
