import { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { prisma } from "./prisma";
import crypto from "crypto";
import bcrypt from "bcryptjs";

// Force reload: 2025-12-25
// Helper to verify passwords using native crypto
// Helper to verify passwords supporting both new pbkdf2 and legacy bcrypt
// Helper to verify passwords supporting both new bcrypt and legacy pbkdf2
function verifyPassword(password: string, hash: string) {
    if (!hash) {
        console.log("[AUTH] No hash provided for verification");
        return false;
    }

    // 1. Check if it's a bcrypt hash (standard for new/legacy bcrypt accounts)
    if (hash.startsWith("$2y$") || hash.startsWith("$2a$") || hash.startsWith("$2b$")) {
        try {
            const trimmedPw = password.trim();
            const match = bcrypt.compareSync(trimmedPw, hash);
            console.log(`[AUTH] Bcrypt match attempt: ${match}`);
            return match;
        } catch (e) {
            console.error("[AUTH] Bcrypt verification error:", e);
            return false;
        }
    }

    // 2. Check if it's the temporary pbkdf2 format: salt:hash
    const parts = hash.split(":");
    if (parts.length === 2) {
        console.log("[AUTH] Verifying as temporary pbkdf2 format");
        const [salt, key] = parts;
        try {
            const trimmedPw = password.trim();
            const derivedKey = crypto.pbkdf2Sync(trimmedPw, salt, 1000, 64, "sha512").toString("hex");
            const match = key === derivedKey;
            console.log(`[AUTH] PBKDF2 match: ${match}`);
            return match;
        } catch (e) {
            console.error("[AUTH] PBKDF2 verification error:", e);
            return false;
        }
    }

    console.log(`[AUTH] Unknown hash format: ${hash.substring(0, 5)}...`);
    return false;
}

import GoogleProvider from "next-auth/providers/google";

export const authOptions: NextAuthOptions = {
    providers: [
        GoogleProvider({
            clientId: process.env.GOOGLE_CLIENT_ID || "",
            clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
        }),
        CredentialsProvider({
            id: "credentials",
            name: "Credentials",
            credentials: {
                email: { label: "Email", type: "text" },
                password: { label: "Password", type: "password" },
            },
            async authorize(credentials) {
                if (!credentials?.email || !credentials?.password) {
                    console.log("[AUTH] Missing email or password");
                    return null;
                }

                try {
                    const normalizedEmail = credentials.email.toLowerCase().trim();
                    console.log(`[AUTH] Attempting login for: ${normalizedEmail}`);

                    let user = await prisma.user.findUnique({
                        where: { email: normalizedEmail }
                    });

                    if (!user) {
                        console.log(`[AUTH] Direct lookup failed for ${normalizedEmail}. Trying case-insensitive...`);
                        user = await prisma.user.findFirst({
                            where: {
                                email: {
                                    equals: normalizedEmail,
                                    mode: 'insensitive'
                                }
                            }
                        });
                    }

                    if (!user) {
                        console.log(`[AUTH] User final lookup failed: ${normalizedEmail}`);
                        throw new Error("USER_NOT_FOUND");
                    }

                    if (!user.password) {
                        console.log(`[AUTH] User has no password (likely social login): ${credentials.email}`);
                        return null;
                    }

                    const isPasswordValid = verifyPassword(credentials.password, user.password);

                    if (!isPasswordValid) {
                        console.log(`[AUTH] Invalid password for: ${normalizedEmail}`);
                        // Return a specific error string that NextAuth will pass to the client
                        throw new Error("INVALID_PASSWORD");
                    }

                    // Defensive Role Promotion: If no owner exists, promote first user
                    let currentRole = (user as any).role || 'user';
                    try {
                        // Use findFirst with role check, but wrap in case the field is missing from runtime schema
                        const anyUserAsOwner = await (prisma.user as any).findFirst({
                            where: { role: 'owner' }
                        });

                        if (!anyUserAsOwner) {
                            await (prisma.user as any).update({
                                where: { id: user.id },
                                data: { role: 'owner' }
                            });
                            currentRole = 'owner';
                            console.log(`[AUTH] Auto-promoted ${normalizedEmail} to owner (no existing owner found)`);
                        }
                    } catch (e: any) {
                        console.warn("[AUTH] Role promotion skipped (likely Prisma sync issue):", e.message);
                        // If it failed because 'role' doesn't exist, we just proceed as 'user'
                    }

                    console.log(`[AUTH] Login successful: ${credentials.email} (${currentRole})`);
                    return {
                        id: user.id.toString(),
                        name: user.name,
                        email: user.email,
                        image: user.image || null,
                        role: currentRole,
                        status: (user as any).status || 'approved',
                    };
                } catch (error: any) {
                    console.error("[AUTH] Fatal error during authorize:", error);
                    throw new Error(error.message || "Authentication service unavailable");
                }
            },
        }),
    ],
    pages: {
        signIn: '/login',
    },
    callbacks: {
        async signIn({ user, account, profile }) {
            if (account?.provider === "google") {
                try {
                    const existingUser = await prisma.user.findUnique({
                        where: { email: user.email as string }
                    });
                    if (!existingUser) {
                        const data: any = {
                            name: user.name,
                            email: user.email,
                            image: user.image,
                        };
                        // Add role only if it doesn't cause a runtime crash (Prisma ignores extra fields usually, but let's be safe)
                        data.role = 'user';

                        await (prisma.user as any).create({
                            data
                        });
                    }
                    return true;
                } catch (e) {
                    console.error("Google Signin DB Error", e);
                    return false;
                }
            }
            return true;
        },
        async jwt({ token, user }) {
            if (user) {
                token.id = (user as any).id;
                token.role = (user as any).role;
                token.status = (user as any).status || 'approved';
            }
            return token;
        },
        async session({ session, token }) {
            if (token && session.user) {
                (session.user as any).id = token.id as string;
                (session.user as any).role = token.role as string;
                (session.user as any).status = token.status as string;
            }
            return session;
        },
    },
    session: {
        strategy: "jwt",
    },
    secret: process.env.NEXTAUTH_SECRET || "fallback-secret-for-dev-only",
    debug: true, // Enable detailed server-side logging
};
