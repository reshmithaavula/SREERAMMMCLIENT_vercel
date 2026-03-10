import { PrismaClient } from "@prisma/client"

const globalForPrisma = global as unknown as {
    prisma: PrismaClient | undefined
}

console.log(">>> [DATABASE] Prisma library initializing...");

export const prisma =
    globalForPrisma.prisma ??
    new PrismaClient({
        log: ["error"]
    })

if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = prisma
}

// Exporting the PrismaClient instance
export default prisma;
