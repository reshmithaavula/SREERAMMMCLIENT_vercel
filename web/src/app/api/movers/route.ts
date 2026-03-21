import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import fs from 'fs'; // Still needed for some fallback logic, but priority is DB
import path from 'path';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { ensureMoversAreFresh } from '@/lib/market-service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url)
    const portfolioTickers = searchParams.get('portfolio')?.split(',') || []
    const portfolioSet = new Set(portfolioTickers.map(t => t.toUpperCase()))

    try {
        // --- LAZY REFRESH ---
        // --- LAZY REFRESH ---
        await ensureMoversAreFresh();

        // -----------------------
        // WATCHLIST CACHE (Legacy/Fallback)
        // -----------------------
        const csvPaths = [
            path.join(process.cwd(), '../Watchlist_New.csv'),
            path.join(process.cwd(), 'public/Watchlist_New.csv'),
            path.join(process.cwd(), 'Watchlist_New.csv'),
        ];

        let csvPath = csvPaths[0];
        for (const p of csvPaths) {
            if (fs.existsSync(p)) {
                csvPath = p;
                break;
            }
        }

        const CACHE_TTL = 60000
        const getGlobalCache = () => (global as any).watchlistCache
        const setGlobalCache = (val: any) => { (global as any).watchlistCache = val }

        if (!getGlobalCache() || (Date.now() - getGlobalCache().timestamp > CACHE_TTL)) {
            try {
                if (fs.existsSync(csvPath)) {
                    const stats = fs.statSync(csvPath)
                    if (!getGlobalCache() || stats.mtimeMs !== getGlobalCache().fileMtime) {
                        const content = fs.readFileSync(csvPath, 'utf-8')
                        const lines = content.split('\n')
                        const newSet = new Set<string>()
                        for (let i = 1; i < lines.length; i++) {
                            const parts = lines[i].split(',')
                            if (parts.length > 1) {
                                const t = parts[1]?.trim().toUpperCase()
                                if (t) newSet.add(t)
                            }
                        }
                        setGlobalCache({
                            set: newSet,
                            timestamp: Date.now(),
                            fileMtime: stats.mtimeMs
                        })
                    }
                }
            } catch (e) {
                console.error("[API Movers] Error reading Watchlist_New.csv:", e)
            }
        }

        const allowedTickersSet = getGlobalCache()?.set || new Set<string>()

        // -----------------------
        // MOMENTUM FROM POSTGRES
        // -----------------------
        let m1 = { rippers: [] as any[], dippers: [] as any[] }
        let m5 = { rippers: [] as any[], dippers: [] as any[] }
        let m30 = { rippers: [] as any[], dippers: [] as any[] }
        let day = { rippers: [] as any[], dippers: [] as any[] }
        let common: any[] = []

        try {
            const movers = await prisma.marketMover.findMany({
                select: {
                    type: true,
                    ticker: true,
                    price: true,
                    changePercent: true,
                    session: true,
                    commonFlag: true,
                    dayOpen: true,
                    prevClose: true
                }
            })

            movers.forEach((m: any) => {
                let changePercent = m.changePercent || 0;
                if (Math.abs(changePercent) < 0.0001 && (m.price || 0) > 0 && (m.prevClose || 0) > 0) {
                    changePercent = ((m.price - m.prevClose) / m.prevClose) * 100;
                }

                const entry = {
                    ticker: m.ticker,
                    price: m.price || 0,
                    change: changePercent,
                    changePercent: changePercent,
                    session: m.session || "Closed",
                    commonFlag: m.commonFlag || 0,
                    openPrice: m.dayOpen || m.prevClose || m.price || 0,
                    prevClose: m.prevClose || 0
                }

                if (m.type === "1m_ripper") m1.rippers.push(entry)
                else if (m.type === "1m_dipper") m1.dippers.push(entry)
                else if (m.type === "5m_ripper") m5.rippers.push(entry)
                else if (m.type === "5m_dipper") m5.dippers.push(entry)
                else if (m.type === "30m_ripper") m30.rippers.push(entry)
                else if (m.type === "30m_dipper") m30.dippers.push(entry)
                else if (m.type === "day_ripper") {
                    day.rippers.push(entry);
                    m1.rippers.push(entry);
                    m5.rippers.push(entry);
                    m30.rippers.push(entry);
                }
                else if (m.type === "day_dipper") {
                    day.dippers.push(entry);
                    m1.dippers.push(entry);
                    m5.dippers.push(entry);
                    m30.dippers.push(entry);
                }

                if (m.commonFlag === 1) common.push(entry)
            })
        } catch (e: any) {
            console.error("[API Movers] Failed to fetch marketMover:", e.message)
        }

        // -----------------------
        // FETCH USER PORTFOLIO
        // -----------------------
        let dbPortfolio: any[] = [];
        try {
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
        } catch (e) {
            console.error("[API Movers] Portfolio fetch failed:", e);
        }

        // -----------------------
        // FETCH LIVE QUOTES
        // -----------------------
        const allMoverTickers = Array.from(new Set([
            ...m1.rippers, ...m1.dippers,
            ...m5.rippers, ...m5.dippers,
            ...m30.rippers, ...m30.dippers,
            ...day.rippers, ...day.dippers,
            ...common
        ].map(e => e.ticker)));

        let quotes: Record<string, any> = {};
        if (allMoverTickers.length > 0) {
            try {
                const { getLiveQuotes } = await import('@/lib/stock-api');
                quotes = await getLiveQuotes(allMoverTickers);
            } catch (e) {
                console.error("[API Movers] Failed to fetch live quotes:", e);
            }
        }

        // -----------------------
        // FETCH WATCHLIST & SECTORS
        // -----------------------
        let watchlist: any[] = [];
        let categories: any[] = [];
        
        // Helper function to process watchlist data
        async function processWatchlistData(items: any[]) {
            const watchlistTickers = items.map(w => w.ticker);
            const { getLiveQuotes } = await import('@/lib/stock-api');
            const watchlistQuotes = await getLiveQuotes(watchlistTickers);

            const dbMovers = await prisma.marketMover.findMany({
                where: { ticker: { in: watchlistTickers } }
            });
            const moverMap: any = {};
            dbMovers.forEach(m => { moverMap[m.ticker] = m; });

            return items.map(w => {
                const quote = watchlistQuotes[w.ticker] || { price: 0, changePercent: 0 };
                const dbMover = moverMap[w.ticker];
                
                let finalPrice = quote.price || dbMover?.price || 0;
                let finalChange = quote.changePercent || dbMover?.changePercent || 0;
                let prevClose = dbMover?.prevClose || 0;

                if (Math.abs(finalChange) < 0.0001 && finalPrice > 0 && prevClose > 0) {
                    finalChange = ((finalPrice - prevClose) / prevClose) * 100;
                }

                return {
                    ...w,
                    ticker: w.ticker,
                    price: finalPrice,
                    changePercent: finalChange,
                    openPrice: dbMover?.dayOpen || dbMover?.prevClose || finalPrice || 0,
                    prevClose: prevClose
                };
            });
        }

        try {
            const dbWatchlist = await prisma.watchlist.findMany({
                select: { ticker: true, category: true }
            });

            if (dbWatchlist.length === 0) {
                // AUTO-SEED: If DB is empty, import from the CSV cache we just read
                const csvTickers = Array.from(allowedTickersSet);
                if (csvTickers.length > 0) {
                    console.log(`[API Movers] Auto-seeding database with ${csvTickers.length} tickers from CSV`);
                    await prisma.watchlist.createMany({
                        data: csvTickers.map(t => ({ ticker: t as string })),
                        skipDuplicates: true
                    });
                    const refreshedDb = await prisma.watchlist.findMany({ select: { ticker: true, category: true } });
                    watchlist = await processWatchlistData(refreshedDb);
                } else {
                    watchlist = [];
                }
            } else {
                watchlist = await processWatchlistData(dbWatchlist);
            }
            
            // Sector Analysis
            const sectorGroups: Record<string, { totalChange: number, count: number, gainers: number, losers: number }> = {};
            watchlist.forEach(w => {
                const name = w.category || 'General';
                const change = w.changePercent || 0;
                if (!sectorGroups[name]) {
                    sectorGroups[name] = { totalChange: 0, count: 0, gainers: 0, losers: 0 };
                }
                sectorGroups[name].totalChange += change;
                sectorGroups[name].count += 1;
                if (change > 0) sectorGroups[name].gainers += 1;
                else if (change < 0) sectorGroups[name].losers += 1;
            });

            categories = Object.entries(sectorGroups).map(([name, stats]) => ({
                category: name,
                averageChange: stats.totalChange / stats.count,
                totalStocks: stats.count,
                gainers: stats.gainers,
                losers: stats.losers,
                neutral: stats.count - stats.gainers - stats.losers,
                strength: (stats.gainers / stats.count) * 100
            })).sort((a, b) => b.averageChange - a.averageChange);

            (global as any).lastCategories = categories;
        } catch (e) {
            console.error("[API Movers] Watchlist/Sector processing failed:", e);
            categories = (global as any).lastCategories || [];
        }

        const sortByChange = (arr: any[], desc: boolean) =>
            [...arr].sort((a, b) => {
                const valA = a.changePercent || 0;
                const valB = b.changePercent || 0;
                return desc ? (valB - valA) : (valA - valB);
            });

        return NextResponse.json({
            movers: {
                m1: { rippers: sortByChange(m1.rippers, true), dippers: sortByChange(m1.dippers, false) },
                m5: { rippers: sortByChange(m5.rippers, true), dippers: sortByChange(m5.dippers, false) },
                m30: { rippers: sortByChange(m30.rippers, true), dippers: sortByChange(m30.dippers, false) },
                day: { rippers: sortByChange(day.rippers, true), dippers: sortByChange(day.dippers, false) },
                common,
                watchlist,
                quotes,
                news: [],
                engineStatus: {
                    lastUpdate: (global as any).lastMoverUpdate || new Date().toISOString(),
                    isLive: (global as any).lastMoverUpdate ? (Date.now() - new Date((global as any).lastMoverUpdate).getTime() < 900000) : false,
                    statusText: (global as any).lastMoverUpdate ? (Date.now() - new Date((global as any).lastMoverUpdate).getTime() < 900000 ? 'Engine Live' : 'Engine Stale') : 'Engine Offline',
                    statusColor: (global as any).lastMoverUpdate ? (Date.now() - new Date((global as any).lastMoverUpdate).getTime() < 900000 ? 'green' : 'yellow') : 'red',
                    session: 'Active'
                },
                botStats: {
                    tweetCount: 0,
                    isActive: true
                },
                categories,
                all: [
                    ...m1.rippers, ...m1.dippers,
                    ...m5.rippers, ...m5.dippers,
                    ...m30.rippers, ...m30.dippers,
                    ...day.rippers, ...day.dippers,
                    ...common
                ]
            },
            watchlist,
            categories,
            portfolio: dbPortfolio,
            debug: {
                allowedTickersCount: allowedTickersSet.size,
                marketMoversCount: allMoverTickers.length,
                timestamp: new Date().toISOString()
            }
        });

    } catch (error: any) {
        console.error('[API Movers] TOP LEVEL CRASH:', error.message);
        return NextResponse.json({
            error: 'Fatal API error',
            message: error.message
        }, { status: 500 });
    }
}
