import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
    console.log('--- ENSURING ADMIN USER ---');
    const adminEmail = 'admin@stocktrack.com';
    const password = 'admin123';
    const hashedPassword = bcrypt.hashSync(password, 10);

    const user = await prisma.user.upsert({
        where: { email: adminEmail },
        update: {
            role: 'owner',
            password: hashedPassword,
        },
        create: {
            email: adminEmail,
            name: 'StockTrack Admin',
            role: 'owner',
            password: hashedPassword,
        },
    });

    console.log('Admin user ensured:', user);
}

main().catch(e => console.error(e)).finally(() => prisma.$disconnect());
