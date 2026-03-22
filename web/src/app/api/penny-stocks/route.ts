import { NextResponse } from 'next/server';
import { getPennyStocks, LiveQuote } from '@/lib/stock-api';
import { prisma } from '@/lib/prisma';
import { ensureMoversAreFresh } from '@/lib/market-service';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
    await ensureMoversAreFresh();
        // 1. Fetch the main penny stocks list
        const stocks = await getPennyStocks(200);
        const pennyTickers = stocks.map(s => s.ticker);
        const tickerSet = new Set(pennyTickers);

        // 2. Fetch movers for these specific tickers from Prisma
        let moversRows: any[] = [];
        try {
            moversRows = await prisma.marketMover.findMany({
                where: {
                    ticker: { in: pennyTickers }
                }
            });
        } catch (e: any) {
            console.error("[API Penny] Failed to fetch market_movers from Prisma:", e.message);
        }

        // 3. Map into categories but ONLY for penny stocks
        const m1 = { rippers: [] as any[], dippers: [] as any[] };
        const m5 = { rippers: [] as any[], dippers: [] as any[] };
        const m30 = { rippers: [] as any[], dippers: [] as any[] };
        const day = { rippers: [] as any[], dippers: [] as any[] };

        moversRows.forEach(row => {
            if (!tickerSet.has(row.ticker)) return;

            const price = row.price || 0;
            let finalChange = row.changePercent || 0;
            // LIVE RECALCULATION: If 0 but we have price + baseline
            if (Math.abs(finalChange) < 0.0001 && price > 0 && (row.prevClose || row.dayOpen || 0) > 0) {
                const baseline = row.dayOpen || row.prevClose;
                finalChange = ((price - baseline) / baseline) * 100;
            }

            const item = {
                ticker: row.ticker,
                price: price,
                change: finalChange,
                changePercent: finalChange,
                openPrice: row.dayOpen || row.prevClose || row.price || 0,
                prevClose: row.prevClose || 0
            };

            // --- DYNAMIC CLASSIFICATION (Unify with Movers API) ---
            if (finalChange > 0) {
                day.rippers.push(item);
                m1.rippers.push(item);
                m5.rippers.push(item);
                m30.rippers.push(item);
            } else if (finalChange < 0) {
                day.dippers.push(item);
                m1.dippers.push(item);
                m5.dippers.push(item);
                m30.dippers.push(item);
            }
        });

        const sortByChange = (arr: any[], desc: boolean) =>
            [...arr].sort((a, b) => {
                const valA = a.changePercent || 0;
                const valB = b.changePercent || 0;
                return desc ? (valB - valA) : (valA - valB);
            });

        // 4. Get engine status (simulated using updatedAt from movers since 'stks' might be separate)
        let engineStatus = { isLive: false, statusText: 'Offline', statusColor: 'red', lastUpdate: new Date().toISOString() };
        try {
            const latestMover = await prisma.marketMover.findFirst({
                orderBy: { updatedAt: 'desc' }
            });
            if (latestMover?.updatedAt) {
                const latency = Date.now() - latestMover.updatedAt.getTime();
                engineStatus = {
                    isLive: latency < 120000,
                    statusText: latency < 60000 ? 'Live' : (latency < 120000 ? 'Delayed' : 'Offline'),
                    statusColor: latency < 60000 ? 'green' : (latency < 120000 ? 'orange' : 'red'),
                    lastUpdate: latestMover.updatedAt.toISOString()
                };
            }
        } catch (e) { }

        return NextResponse.json({
            stocks,
            m1: { rippers: sortByChange(m1.rippers, true), dippers: sortByChange(m1.dippers, false) },
            m5: { rippers: sortByChange(m5.rippers, true), dippers: sortByChange(m5.dippers, false) },
            m30: { rippers: sortByChange(m30.rippers, true), dippers: sortByChange(m30.dippers, false) },
            day: { rippers: sortByChange(day.rippers, true), dippers: sortByChange(day.dippers, false) },
            engineStatus
        });
    } catch (error) {
        console.error('API Error (Penny Stocks):', error);
        return NextResponse.json({ error: 'Failed to fetch penny stocks' }, { status: 500 });
    }
}
