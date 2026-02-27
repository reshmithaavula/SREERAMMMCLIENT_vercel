import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { sendAdminApprovalEmail } from "@/lib/mailer";

function hashPassword(password: string) {
    return bcrypt.hashSync(password, 10);
}

export async function POST(req: NextRequest) {
    try {
        let { name, email, password, isAdminRequest } = await req.json();

        if (email) email = email.toLowerCase().trim();

        if (!email || !password) {
            return NextResponse.json(
                { message: "Missing email or password" },
                { status: 400 }
            );
        }

        const existingUser = await prisma.user.findUnique({ where: { email } });

        if (existingUser) {
            return NextResponse.json(
                { message: "User already exists" },
                { status: 400 }
            );
        }

        const hashedPassword = hashPassword(password);
        const displayName = name?.trim() || email.split("@")[0];

        // Normal User Registration (Instant Approval)
        if (!isAdminRequest) {
            const user = await prisma.user.create({
                data: {
                    name: displayName,
                    email,
                    password: hashedPassword,
                    role: "user",
                },
            });

            // Set them as approved immediately
            await prisma.$executeRaw`
                UPDATE "User" 
                SET status = 'approved'
                WHERE id = ${user.id}
            `;

            return NextResponse.json(
                {
                    message: "Registration successful. You can now log in.",
                    pending: false
                },
                { status: 201 }
            );
        }

        // Admin Request Registration (Requires Approval Email)
        const approvalToken = crypto.randomBytes(32).toString('hex');

        const user = await prisma.user.create({
            data: {
                name: displayName,
                email,
                password: hashedPassword,
                role: "user",
            },
        });

        await prisma.$executeRaw`
            UPDATE "User" 
            SET status = 'pending', "approvalToken" = ${approvalToken}
            WHERE id = ${user.id}
        `;

        try {
            await sendAdminApprovalEmail({
                id: user.id,
                name: displayName,
                email,
                approvalToken,
            });
            console.log(`[REGISTER] Approval email sent for ${email}`);
        } catch (mailErr) {
            console.error("[REGISTER] Failed to send approval email:", mailErr);
        }

        return NextResponse.json(
            {
                message: "Registration successful. Awaiting admin approval.",
                pending: true
            },
            { status: 201 }
        );
    } catch (error: any) {
        console.error("Full Registration Error:", error);
        return NextResponse.json(
            {
                message: `Registration failed. Error: ${error.message || "Internal server error"}`,
                code: error.code || "UNKNOWN"
            },
            { status: 500 }
        );
    }
}
