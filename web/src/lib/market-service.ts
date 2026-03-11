import { prisma } from './prisma';

const POLYGON_API_KEY = process.env.POLYGON_API_KEY || process.env.API_KEY;
const BASE_URL = 'https://api.polygon.io';

export async function updateMarketMovers(maxToProcess: number = 20) {
    if (!POLYGON_API_KEY) {
        console.error('[Market Service] No API_KEY found');
        return { success: false, message: 'No API Key' };
    }

    try {
        const watchlist = await prisma.watchlist.findMany({ select: { ticker: true } });
        let tickers = watchlist.map(w => w.ticker.toUpperCase().trim()).filter(t => t.length > 0);

        try {
            const fs = await import('fs');
            const path = await import('path');
            const pennyPath = path.join(process.cwd(), '../Watchlist_Penny.csv');
            if (fs.existsSync(pennyPath)) {
                const content = fs.readFileSync(pennyPath, 'utf-8');
                const lines = content.split('\n').filter(l => l.trim().length > 0).slice(1);
                lines.forEach(line => {
                    const t = line.split(',')[1]?.trim().toUpperCase();
                    if (t && !tickers.includes(t)) tickers.push(t);
                });
            }
        } catch (e) { }

        if (tickers.length === 0) return { success: true, message: 'No tickers to sync' };

        // Check which ones need an update (older than 10 mins)
        const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000);
        const existingMovers = await prisma.marketMover.findMany({
            where: { updatedAt: { gt: tenMinsAgo } },
            select: { ticker: true }
        });
        const freshTickers = new Set(existingMovers.map(m => m.ticker));
        const pendingTickers = tickers.filter(t => !freshTickers.has(t)).slice(0, maxToProcess);

        if (pendingTickers.length === 0) {
            return { success: true, message: 'All tickers already fresh' };
        }

        console.log(`[Market Service] Batch Sync: Processing ${pendingTickers.length} out of ${tickers.length} remaining tickers...`);

        const allTickersData: any[] = [];

        console.log(`[Market Service] Using individual fetching for ${pendingTickers.length} tickers to avoid Snapshot 403...`);
        for (const ticker of pendingTickers) {
            try {
                // 1. Get Prev Close
                const prevUrl = `${BASE_URL}/v2/aggs/ticker/${ticker}/prev?adjusted=true&apiKey=${POLYGON_API_KEY}`;
                const prevRes = await fetch(prevUrl);

                // 2. Get Last Trade (Current Price)
                const tradeUrl = `${BASE_URL}/v1/last/stocks/${ticker}?apiKey=${POLYGON_API_KEY}`;
                const tradeRes = await fetch(tradeUrl);

                if (prevRes.status === 429 || tradeRes.status === 429) {
                    console.warn(`[Market Service] Rate limit (429) hit at ${ticker}. Stopping batch.`);
                    break;
                }

                if (prevRes.ok && tradeRes.ok) {
                    const prevData = await prevRes.json();
                    const tradeData = await tradeRes.json();

                    const prevClose = prevData.results?.[0]?.c || 0;
                    const lastPrice = tradeData.last?.price || tradeData.last?.p || prevClose;

                    const changePerc = prevClose > 0 ? ((lastPrice - prevClose) / prevClose) * 100 : 0;

                    allTickersData.push({
                        ticker: ticker,
                        lastTrade: { p: lastPrice, t: Date.now() },
                        todaysChangePerc: changePerc,
                        day: { o: prevClose },
                        prevDay: { c: prevClose }
                    });
                    console.log(`[Market Service] Sync'd ${ticker}: $${lastPrice} (${changePerc.toFixed(2)}%)`);
                } else {
                    // Mark as updated even if failed so we move to next tickers
                    allTickersData.push({
                        ticker: ticker,
                        lastTrade: { p: 0, t: Date.now() },
                        todaysChangePerc: 0,
                        day: { o: 0 },
                        prevDay: { c: 0 }
                    });
                    console.warn(`[Market Service] ${ticker} failed (Status: ${prevRes.status}/${tradeRes.status}). Marked to skip for next 10 mins.`);
                }
            } catch (e: any) {
                console.error(`[Market Service] Exception for ${ticker}:`, e.message);
            }
        }

        if (allTickersData.length === 0) {
            return {
                success: false,
                message: 'No data retrieved. You are likely being RATE LIMITED by Polygon (5 calls/min). Please wait 60 seconds and try again.'
            };
        }

        const now = new Date();
        const getSession = () => {
            const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
            const hour = nowET.getHours();
            const time = hour * 100 + nowET.getMinutes();
            if (time >= 400 && time < 930) return 'Pre-Market';
            if (time >= 930 && time < 1600) return 'Regular';
            if (time >= 1600 && time < 2000) return 'Post-Market';
            return 'Closed';
        };
        const currentSession = getSession();

        // Match and update each ticker in a single transaction
        await prisma.$transaction(async (tx) => {
            for (const t of allTickersData) {
                const price = t.lastTrade?.p || t.min?.c || t.prevDay?.c || 0;
                const prevClose = t.prevDay?.c || 0;
                let changePercent = t.todaysChangePerc || 0;

                if (prevClose > 0) {
                    changePercent = ((price - prevClose) / prevClose) * 100;
                }

                const mover = {
                    ticker: t.ticker,
                    price: price,
                    changePercent: changePercent,
                    dayOpen: t.day?.o || t.lastTrade?.p || 0,
                    prevClose: prevClose,
                    type: changePercent > 0 ? 'day_ripper' : (changePercent < 0 ? 'day_dipper' : 'neutral'),
                    session: currentSession,
                    updatedAt: now,
                };

                const isCommon = ['AAPL', 'AMZN', 'GOOG', 'GOOGL', 'META', 'MSFT', 'NVDA', 'TSLA', 'AMD', 'SPY', 'QQQ'].includes(mover.ticker);

                const finalMover = {
                    ...mover,
                    commonFlag: isCommon ? 1 : 0,
                    common_flag: isCommon ? 1 : 0
                };

                try {
                    // To avoid having both ripper and dipper for one ticker:
                    // Delete any existing record for this ticker first.
                    await tx.marketMover.deleteMany({
                        where: { ticker: finalMover.ticker }
                    });

                    await tx.marketMover.create({
                        data: finalMover
                    });
                } catch (upsertErr: any) {
                    console.error(`[Market Service] Transaction step failed for ${finalMover.ticker}:`, upsertErr.message);
                }
            }
        });

        return {
            success: true,
            message: `Batch sync complete: ${allTickersData.length} records updated. ${tickers.length - (existingMovers.length + allTickersData.length)} remaining.`,
            remaining: tickers.length - (existingMovers.length + allTickersData.length)
        };
    } catch (error: any) {
        console.error('[Market Service] Sync failure:', error);
        return { success: false, message: error.message };
    }
}

export async function ensureMoversAreFresh() {
    // Disabled in Production to prevent Rate Limit (429) storm
    // Manual sync via /api/sync is preferred for Polygon Free Tier
    return;
}
