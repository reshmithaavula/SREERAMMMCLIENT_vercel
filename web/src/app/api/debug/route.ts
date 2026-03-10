import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export const dynamic = 'force-dynamic';

export async function GET() {
    const diagnostics: any = {
        timestamp: new Date().toISOString(),
        env: {
            DATABASE_URL: process.env.DATABASE_URL ? 'SET (Hidden for security)' : 'NOT SET',
            POLYGON_API_KEY: process.env.POLYGON_API_KEY ? 'SET (Hidden for security)' : 'NOT SET',
            NEXTAUTH_URL: process.env.NEXTAUTH_URL || 'NOT SET',
            NODE_ENV: process.env.NODE_ENV,
        },
        database: {
            connected: false,
            error: null,
            counts: {
                users: 0,
                watchlist: 0,
                marketMovers: 0,
                portfolioHoldings: 0,
            }
        }
    };

    try {
        // Test connection with a simple query
        await prisma.$queryRaw`SELECT 1`;
        diagnostics.database.connected = true;

        // Get record counts and last update
        const [userCount, watchlistCount, moverCount, portfolioCount, lastMover] = await Promise.all([
            prisma.user.count(),
            prisma.watchlist.count(),
            prisma.marketMover.count(),
            prisma.portfolioHolding.count(),
            prisma.marketMover.findFirst({ orderBy: { updatedAt: 'desc' }, select: { updatedAt: true } })
        ]);

        diagnostics.database.counts = {
            users: userCount,
            watchlist: watchlistCount,
            marketMovers: moverCount,
            portfolioHoldings: portfolioCount,
        };
        diagnostics.database.lastUpdate = lastMover?.updatedAt || null;

        // TEST POLYGON API
        if (process.env.POLYGON_API_KEY) {
            diagnostics.polygon = { status: 'testing', error: null };
            try {
                const testUrl = `https://api.polygon.io/v2/snapshot/locale/us/markets/stocks/tickers?tickers=AAPL&apiKey=${process.env.POLYGON_API_KEY}`;
                const res = await fetch(testUrl);
                if (res.ok) {
                    const data = await res.json();
                    diagnostics.polygon.status = 'WORKING';
                    diagnostics.polygon.count = data.tickers?.length || 0;
                } else {
                    const errData = await res.json().catch(() => ({}));
                    diagnostics.polygon.status = 'FAILED';
                    diagnostics.polygon.statusCode = res.status;
                    diagnostics.polygon.error = errData.error || errData.message || JSON.stringify(errData) || 'Unauthorized/Forbidden';
                    diagnostics.polygon.hint = res.status === 401 ? 'Check if API Key is correct' : (res.status === 403 ? 'Plan might not support Snapshot API' : 'Unknown');
                }
            } catch (e: any) {
                diagnostics.polygon.status = 'ERROR';
                diagnostics.polygon.error = e.message;
            }
        }
    } catch (error: any) {
        diagnostics.database.connected = false;
        diagnostics.database.error = error.message;
    }

    return NextResponse.json(diagnostics);
}
