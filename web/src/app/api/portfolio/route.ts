import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { ensureMoversAreFresh } from '@/lib/market-service';

/**
 * GET /api/portfolio
 * Returns all holdings for the authenticated user.
 */
export async function GET(req: NextRequest) {
    try {
        // await ensureMoversAreFresh();
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const user = await prisma.user.findUnique({
            where: { email: session.user.email },
            include: { portfolio: true }
        });

        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        const mapped = user.portfolio.map(p => ({
            ticker: p.ticker,
            shares: p.shares,
            avgCost: p.avgCost
        }));

        return NextResponse.json(mapped);

    } catch (error: any) {
        console.error('[API Portfolio GET] Error:', error.message);
        return NextResponse.json({ error: 'Internal server error', message: error.message }, { status: 500 });
    }
}

/**
 * DELETE /api/portfolio
 * Removes a ticker from the user's portfolio.
 * Body: { ticker: string }
 */
export async function DELETE(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { ticker } = await req.json();
        if (!ticker) {
            return NextResponse.json({ error: 'Ticker is required' }, { status: 400 });
        }

        const user = await prisma.user.findUnique({
            where: { email: session.user.email },
            select: { id: true }
        });

        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        // Delete all holdings for this ticker for this user
        await prisma.portfolioHolding.deleteMany({
            where: {
                userId: user.id,
                ticker: ticker.toUpperCase()
            }
        });

        return NextResponse.json({ success: true, message: `Ticker ${ticker} removed from portfolio.` });

    } catch (error: any) {
        console.error('[API Portfolio DELETE] Error:', error.message);
        return NextResponse.json({ error: 'Internal server error', message: error.message }, { status: 500 });
    }
}

/**
 * POST /api/portfolio
 * Adds a ticker to the user's portfolio.
 * Body: { ticker: string, shares: number, avgCost: number }
 */
export async function POST(req: NextRequest) {
    try {
        const session = await getServerSession(authOptions);
        if (!session?.user?.email) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { ticker, shares, avgCost } = await req.json();
        if (!ticker || shares == null) {
            return NextResponse.json({ error: 'Ticker and shares are required' }, { status: 400 });
        }

        const user = await prisma.user.findUnique({
            where: { email: session.user.email },
            select: { id: true }
        });

        if (!user) {
            return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        await prisma.portfolioHolding.create({
            data: {
                ticker: ticker.toUpperCase(),
                shares: parseFloat(shares),
                avgCost: parseFloat(avgCost || 0),
                userId: user.id
            }
        });

        return NextResponse.json({ success: true, message: `Ticker ${ticker} added to portfolio.` });

    } catch (error: any) {
        console.error('[API Portfolio POST] Error:', error.message);
        return NextResponse.json({ error: 'Internal server error', message: error.message }, { status: 500 });
    }
}
