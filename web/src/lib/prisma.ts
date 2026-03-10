import { PrismaClient } from "@prisma/client"

const globalForPrisma = global as unknown as {
    prisma: PrismaClient | undefined
}

export const prisma =
    globalForPrisma.prisma ??
    new PrismaClient({
        log: ["error"]
    })

if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = prisma
}

// Ensure DB connection log
prisma.$connect()
    .then(() => console.log(">>> [DATABASE] db is connected"))
    .catch((err) => console.error(">>> [DATABASE] Connection failed:", err));
