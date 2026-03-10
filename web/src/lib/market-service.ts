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

        // Try snapshot first for the whole batch
        const url = `${BASE_URL}/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${pendingTickers.join(',')}&apiKey=${POLYGON_API_KEY}`;
        const res = await fetch(url);

        if (res.status === 403) {
            console.warn(`[Market Service] Snapshot 403. Using individual aggregator for ${pendingTickers.length} tickers...`);
            for (const ticker of pendingTickers) {
                try {
                    const prevUrl = `${BASE_URL}/v2/aggs/ticker/${ticker}/prev?adjusted=true&apiKey=${POLYGON_API_KEY}`;
                    console.log(`[Market Service] Fallback fetching: ${ticker}`);
                    const prevRes = await fetch(prevUrl);

                    if (prevRes.status === 429) {
                        console.warn(`[Market Service] Rate limit (429) hit at ${ticker}. Stopping batch.`);
                        break;
                    }

                    if (prevRes.ok) {
                        const prevData = await prevRes.json();
                        if (prevData.results && prevData.results.length > 0) {
                            const r = prevData.results[0];
                            allTickersData.push({
                                ticker: ticker,
                                lastTrade: { p: r.c, t: r.t },
                                todaysChangePerc: 0,
                                day: { o: r.o },
                                prevDay: { c: r.c }
                            });
                            console.log(`[Market Service] Fallback success: ${ticker} @ ${r.c}`);
                        } else {
                            console.warn(`[Market Service] No results in fallback for ${ticker}`);
                        }
                    } else {
                        const errText = await prevRes.text().catch(() => 'No body');
                        console.warn(`[Market Service] Fallback failed for ${ticker}: ${prevRes.status} - ${errText}`);
                    }
                } catch (e: any) {
                    console.error(`[Market Service] Fallback exception for ${ticker}:`, e.message);
                }
            }
        } else if (res.ok) {
            const data = await res.json();
            if (data.tickers && data.tickers.length > 0) {
                allTickersData.push(...data.tickers);
            } else {
                console.warn(`[Market Service] Snapshot returned 200 OK but 0 tickers. URL: ${url.replace(POLYGON_API_KEY as string, 'HIDDEN')}`);
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
                    type: changePercent >= 0 ? 'day_ripper' : 'day_dipper',
                    session: currentSession,
                    updatedAt: now,
                    common_flag: 0,
                    commonFlag: 0
                };

                try {
                    // Delete any existing record for this ticker first.
                    await tx.marketMover.deleteMany({
                        where: { ticker: mover.ticker }
                    });

                    // Create the new mover record.
                    await tx.marketMover.create({
                        data: mover
                    });
                } catch (upsertErr: any) {
                    console.error(`[Market Service] Transaction step failed for ${mover.ticker}:`, upsertErr.message);
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
