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
        let { name, email, password, role } = await req.json();

        // Default to user if not provided
        if (!role) role = "user";

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
        const approvalToken = crypto.randomBytes(32).toString('hex');
        const displayName = name?.trim() || email.split("@")[0];

        // Step 1: Create user with standard fields only (Prisma client may not yet know about new fields)
        const user = await prisma.user.create({
            data: {
                name: displayName,
                email,
                password: hashedPassword,
                role: role,
                status: role === "admin" ? "pending" : "approved"
            },
        });

        // Step 2: Send approval email ONLY for admins
        if (role === 'admin') {
            await prisma.$executeRaw`
                UPDATE "User" 
                SET "approvalToken" = ${approvalToken}
                WHERE id = ${user.id}
            `;

            // Step 3: Send approval email to owner
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

            );
        }

        return NextResponse.json(
            {
                message: "Registration successful. You can now login.",
                pending: false
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
