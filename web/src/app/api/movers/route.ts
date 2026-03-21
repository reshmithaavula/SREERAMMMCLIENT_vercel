import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import fs from 'fs';
import path from 'path';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { ensureMoversAreFresh } from '@/lib/market-service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * API: /api/movers
 * Restores market data and watchlists into the new PostgreSQL database.
 */
export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const portfolioTickers = searchParams.get('portfolio')?.split(',') || [];
    
    // --- TOP LEVEL VARIABLES ---
    let m1 = { rippers: [] as any[], dippers: [] as any[] };
    let m5 = { rippers: [] as any[], dippers: [] as any[] };
    let m30 = { rippers: [] as any[], dippers: [] as any[] };
    let day = { rippers: [] as any[], dippers: [] as any[] };
    let common: any[] = [];
    let watchlist: any[] = [];
    let categories: any[] = [];
    let dbPortfolio: any[] = [];
    let quotes: Record<string, any> = {};
    let syncError: string | null = null;
    let allowedTickersCount = 0;

    try {
        // 1. TRIGGER SYNC (Snapshot + Batch)
        try {
            await ensureMoversAreFresh();
        } catch (e: any) {
            syncError = e.message;
        }

        // 2. READ LEGACY CSV CACHE (For Seeding Fallback)
        let allowedTickers: string[] = [];
        try {
            const csvPath = path.join(process.cwd(), 'Watchlist_New.csv');
            if (fs.existsSync(csvPath)) {
                const content = fs.readFileSync(csvPath, 'utf-8');
                const lines = content.split('\n').slice(1);
                allowedTickers = lines.map(l => l.split(',')[1]?.trim().toUpperCase()).filter(Boolean);
            }
            allowedTickersCount = allowedTickers.length;
        } catch (e) {
            console.error("[API Movers] CSV Read error:", e);
        }

        // 3. FETCH DATA FROM POSTGRES
        const movers = await prisma.marketMover.findMany();
        movers.forEach((m: any) => {
            const change = m.changePercent || 0;
            const entry = {
                ticker: m.ticker,
                price: m.price || 0,
                change: change,
                changePercent: change,
                session: m.session || "Closed",
                commonFlag: m.commonFlag || 0,
                openPrice: m.dayOpen || m.prevClose || m.price || 0,
                prevClose: m.prevClose || 0
            };

            if (m.type === "day_ripper") {
                day.rippers.push(entry);
                m1.rippers.push(entry);
                m5.rippers.push(entry);
                m30.rippers.push(entry);
            } else if (m.type === "day_dipper") {
                day.dippers.push(entry);
                m1.dippers.push(entry);
                m5.dippers.push(entry);
                m30.dippers.push(entry);
            }

            if (m.commonFlag === 1) common.push(entry);
        });

        // 4. FETCH USER PORTFOLIO
        const session = await getServerSession(authOptions);
        if (session?.user?.email) {
            const user = await prisma.user.findUnique({
                where: { email: session.user.email },
                include: { portfolio: true }
            });
            if (user?.portfolio) {
                dbPortfolio = user.portfolio.map(p => ({
                    ticker: p.ticker,
                    avgCost: p.avgCost,
                    shares: p.shares
                }));
            }
        }

        // 5. PROCESS WATCHLIST (With Auto-Seeding)
        const dbWatchlist = await prisma.watchlist.findMany();
        
        async function getWatchlistData(items: any[]) {
            const tickers = items.map(w => w.ticker);
            const { getLiveQuotes } = await import('@/lib/stock-api');
            const liveQuotes = await getLiveQuotes(tickers);

            return items.map(w => {
                const q = liveQuotes[w.ticker] || { price: 0, changePercent: 0 };
                return {
                    ...w,
                    price: q.price,
                    changePercent: q.changePercent
                };
            });
        }

        if (dbWatchlist.length === 0) {
            // SEEDING: If DB is empty, use CSV or common fallback
            let seedTickers = allowedTickers.length > 0 ? allowedTickers : ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'TSLA', 'GME', 'AMC'];
            console.log(`[API Movers] Seeding DB with ${seedTickers.length} tickers`);
            await prisma.watchlist.createMany({
                data: seedTickers.map(t => ({ ticker: t })),
                skipDuplicates: true
            });
            const freshDb = await prisma.watchlist.findMany();
            watchlist = await getWatchlistData(freshDb);
        } else {
            watchlist = await getWatchlistData(dbWatchlist);
        }

        // 6. SECTOR ANALYSIS
        const sectorGroups: Record<string, any> = {};
        watchlist.forEach(w => {
            const cat = w.category || 'General';
            if (!sectorGroups[cat]) sectorGroups[cat] = { total: 0, count: 0, gainers: 0, losers: 0 };
            sectorGroups[cat].total += w.changePercent || 0;
            sectorGroups[cat].count++;
            if (w.changePercent > 0) sectorGroups[cat].gainers++;
            else if (w.changePercent < 0) sectorGroups[cat].losers++;
        });

        categories = Object.entries(sectorGroups).map(([name, stats]: [string, any]) => ({
            category: name,
            averageChange: stats.total / stats.count,
            totalStocks: stats.count,
            gainers: stats.gainers,
            losers: stats.losers,
            neutral: stats.count - stats.gainers - stats.losers,
            strength: (stats.gainers / stats.count) * 100
        })).sort((a, b) => b.averageChange - a.averageChange);

        // 7. SORT HELPER
        const sortByChange = (arr: any[], desc: boolean) =>
            [...arr].sort((a, b) => (desc ? (b.change - a.change) : (a.change - b.change)));

        return NextResponse.json({
            movers: {
                m1: { rippers: sortByChange(m1.rippers, true), dippers: sortByChange(m1.dippers, false) },
                m5: { rippers: sortByChange(m5.rippers, true), dippers: sortByChange(m5.dippers, false) },
                m30: { rippers: sortByChange(m30.rippers, true), dippers: sortByChange(m30.dippers, false) },
                day: { rippers: sortByChange(day.rippers, true), dippers: sortByChange(day.dippers, false) },
                common,
                watchlist,
                engineStatus: {
                    lastUpdate: (global as any).lastMoverUpdate || new Date().toISOString(),
                    isLive: !!(global as any).lastMoverUpdate,
                    statusText: (global as any).lastMoverUpdate ? 'Engine Live' : 'Engine Starting...',
                    statusColor: (global as any).lastMoverUpdate ? 'green' : 'yellow'
                },
                categories
            },
            watchlist,
            categories,
            portfolio: dbPortfolio,
            debug: {
                allowedTickersCount,
                marketMoversCount: movers.length,
                syncError,
                timestamp: new Date().toISOString()
            }
        });

    } catch (error: any) {
        console.error('[API Movers] CRASH:', error.message);
        return NextResponse.json({ error: 'Internal Error', message: error.message }, { status: 500 });
    }
}
