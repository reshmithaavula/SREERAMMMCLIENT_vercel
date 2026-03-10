const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const prisma = new PrismaClient();

async function main() {
    const users = await prisma.user.findMany();
    let output = '--- Current Users ---\n';
    users.forEach(u => {
        output += `ID: ${u.id} | Name: ${u.name} | Email: ${u.email} | Role: ${u.role}\n`;
    });
    fs.writeFileSync('scripts/users_output.txt', output);
    console.log('Output written to scripts/users_output.txt');
}

main()
    .catch(e => console.error(e))
    .finally(async () => await prisma.$disconnect());
