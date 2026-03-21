import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import fs from 'fs';
import path from 'path';
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { ensureMoversAreFresh } from '@/lib/market-service';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const forceSync = searchParams.get('sync') === 'true';
    
    let m1 = { rippers: [] as any[], dippers: [] as any[] };
    let m5 = { rippers: [] as any[], dippers: [] as any[] };
    let m30 = { rippers: [] as any[], dippers: [] as any[] };
    let day = { rippers: [] as any[], dippers: [] as any[] };
    let common: any[] = [];
    let watchlist: any[] = [];
    let categories: any[] = [];
    let dbPortfolio: any[] = [];
    let syncError: string | null = null;

    try {
        // 1. SYNC
        if (forceSync) {
            console.log("[API Movers] Force Sync Triggered");
            await ensureMoversAreFresh();
        } else {
            await ensureMoversAreFresh();
        }

        // 2. FETCH MOVERS (Dynamic Classification)
        const movers = await prisma.marketMover.findMany();
        movers.forEach((m: any) => {
            const changePercent = m.changePercent || 0;
            const entry = {
                ticker: m.ticker,
                price: m.price || 0,
                change: changePercent,
                changePercent: changePercent,
                session: m.session || "Closed",
                commonFlag: m.commonFlag || 0,
                openPrice: m.dayOpen || m.prevClose || m.price || 0,
                prevClose: m.prevClose || 0
            };

            // DYNAMIC CLASSIFICATION: Don't trust the 'type' field, trust the 'changePercent'
            if (changePercent > 0) {
                day.rippers.push(entry);
                m1.rippers.push(entry);
                m5.rippers.push(entry);
                m30.rippers.push(entry);
            } else if (changePercent < 0) {
                day.dippers.push(entry);
                m1.dippers.push(entry);
                m5.dippers.push(entry);
                m30.dippers.push(entry);
            }

            if (m.commonFlag === 1) common.push(entry);
        });

        // 3. WATCHLIST & SEEDING
        const dbWatchlist = await prisma.watchlist.findMany();

        // Helper to fetch live quotes for Watchlist
        async function fetchWatchlistData(items: any[]) {
            const tickers = items.map(w => w.ticker);
            const { getLiveQuotes } = await import('@/lib/stock-api');
            const quotes = await getLiveQuotes(tickers);
            return items.map(w => {
                const q = quotes[w.ticker] || { price: 0, changePercent: 0 };
                return { ...w, price: q.price, changePercent: q.changePercent };
            });
        }

        if (dbWatchlist.length === 0) {
            const fallback = ['AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'TSLA', 'GME', 'AMC', 'CHPT', 'IREN', 'DNA', 'SPY', 'QQQ', 'BTC-USD', 'ETH-USD'];
            await prisma.watchlist.createMany({ data: fallback.map(t => ({ ticker: t })), skipDuplicates: true });
            const fresh = await prisma.watchlist.findMany();
            watchlist = await fetchWatchlistData(fresh);
        } else {
            watchlist = await fetchWatchlistData(dbWatchlist);
        }

        // 4. PORTFOLIO
        const session = await getServerSession(authOptions);
        if (session?.user?.email) {
            const user = await prisma.user.findUnique({ where: { email: session.user.email }, include: { portfolio: true } });
            if (user?.portfolio) dbPortfolio = user.portfolio.map(p => ({ ticker: p.ticker, avgCost: p.avgCost, shares: p.shares }));
        }

        // 5. SECTORS
        const sectors: Record<string, any> = {};
        watchlist.forEach(w => {
            const c = w.category || 'General';
            if (!sectors[c]) sectors[c] = { sum: 0, count: 0, up: 0, down: 0 };
            sectors[c].sum += w.changePercent || 0;
            sectors[c].count++;
            if (w.changePercent > 0) sectors[c].up++;
            else if (w.changePercent < 0) sectors[c].down++;
        });

        categories = Object.entries(sectors).map(([name, s]) => ({
            category: name,
            averageChange: s.sum / s.count,
            totalStocks: s.count,
            gainers: s.up,
            losers: s.down,
            neutral: s.count - s.up - s.down,
            strength: (s.up / s.count) * 100
        })).sort((a, b) => b.averageChange - a.averageChange);

        // 6. SORT & RETURN
        const sort = (rows: any[], desc: boolean) => [...rows].sort((a, b) => desc ? (b.change - a.change) : (a.change - b.change));

        return NextResponse.json({
            movers: {
                m1: { rippers: sort(m1.rippers, true).slice(0, 20), dippers: sort(m1.dippers, false).slice(0, 20) },
                m5: { rippers: sort(m5.rippers, true).slice(0, 20), dippers: sort(m5.dippers, false).slice(0, 20) },
                m30: { rippers: sort(m30.rippers, true).slice(0, 20), dippers: sort(m30.dippers, false).slice(0, 20) },
                day: { rippers: sort(day.rippers, true).slice(0, 20), dippers: sort(day.dippers, false).slice(0, 20) },
                common,
                watchlist,
                engineStatus: {
                    lastUpdate: (global as any).lastMoverUpdate || new Date().toISOString(),
                    isLive: !!(global as any).lastMoverUpdate,
                    statusText: (global as any).lastMoverUpdate ? 'Engine Live' : 'Engine Synched',
                    statusColor: 'green'
                },
                categories
            },
            watchlist,
            categories,
            portfolio: dbPortfolio,
            debug: { count: movers.length, syncError, timestamp: new Date().toISOString() }
        });

    } catch (error: any) {
        console.error('[API Movers] Error:', error.message);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
