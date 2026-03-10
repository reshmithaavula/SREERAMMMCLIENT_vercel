import { prisma } from './prisma';

const POLYGON_API_KEY = process.env.POLYGON_API_KEY || process.env.API_KEY;
const BASE_URL = 'https://api.polygon.io';

export async function updateMarketMovers() {
    if (!POLYGON_API_KEY) {
        console.error('[Market Service] No API_KEY found');
        return;
    }

    try {
        const watchlist = await prisma.watchlist.findMany({ select: { ticker: true } });
        let tickers = watchlist.map(w => w.ticker.toUpperCase());

        // Also add tickers from Penny Watchlist CSV for the Penny Matrix
        try {
            const fs = await import('fs');
            const path = await import('path');
            const pennyPath = path.join(process.cwd(), '../Watchlist_Penny.csv');
            if (fs.existsSync(pennyPath)) {
                const content = fs.readFileSync(pennyPath, 'utf-8');
                const lines = content.split('\n').slice(1);
                lines.forEach(line => {
                    const t = line.split(',')[1]?.trim().toUpperCase();
                    if (t && !tickers.includes(t)) tickers.push(t);
                });
            }
        } catch (e) {
            console.warn('[Market Service] Failed to load Penny Watchlist CSV');
        }

        if (tickers.length === 0) return;

        console.log(`[Market Service] Fetching snapshots for ${tickers.length} tickers...`);

        const allTickersData: any[] = [];
        const batchSize = 50;
        for (let i = 0; i < tickers.length; i += batchSize) {
            const batch = tickers.slice(i, i + batchSize);
            const url = `${BASE_URL}/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${batch.join(',')}&apiKey=${POLYGON_API_KEY}`;
            const res = await fetch(url);

            if (res.status === 403) {
                console.warn(`[Market Service] Snapshot API 403. Falling back to individual quotes for batch ${i / batchSize + 1}...`);
                // Fallback: Fetch one by one (respecting 5 calls/min for free tier if needed, 
                // but we'll try to burst first as some 'free' keys have higher burst limits)
                for (const ticker of batch) {
                    try {
                        const tradeUrl = `${BASE_URL}/v2/last/trade/${ticker}?apiKey=${POLYGON_API_KEY}`;
                        const tradeRes = await fetch(tradeUrl);
                        if (tradeRes.ok) {
                            const tradeData = await tradeRes.json();
                            if (tradeData.results) {
                                allTickersData.push({
                                    ticker: ticker,
                                    lastTrade: { p: tradeData.results.p, t: tradeData.results.t },
                                    todaysChangePerc: 0, // Individual trade doesn't give daily change easily
                                    day: { o: 0 }
                                });
                            }
                        }
                        // Small delay to help with rate limits if we hit them
                        if (tradeRes.status === 429) {
                            console.warn('[Market Service] Rate limit hit during fallback. Waiting 60s...');
                            await new Promise(resolve => setTimeout(resolve, 60000));
                        }
                    } catch (e) {
                        console.error(`[Market Service] Fallback fetch failed for ${ticker}:`, e);
                    }
                }
                continue;
            }

            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                console.error(`[Market Service] Batch fetch failed: ${res.status} - ${errData.error || errData.message || 'Unknown'}`);
                continue;
            }
            const data = await res.json();
            if (data.tickers) allTickersData.push(...data.tickers);
        }

        console.log(`[Market Service] Processing ${allTickersData.length} records...`);

        const allMovers: any[] = [];
        const now = new Date();

        const getSession = () => {
            const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
            const hour = nowET.getHours();
            const min = nowET.getMinutes();
            const time = hour * 100 + min;

            if (time >= 400 && time < 930) return 'Pre-Market';
            if (time >= 930 && time < 1600) return 'Regular';
            if (time >= 1600 && time < 2000) return 'Post-Market';
            return 'Closed';
        };

        const currentSession = getSession();

        const createEntry = (t: any, overrideChange: number, type: string) => ({
            ticker: t.ticker,
            price: t.lastTrade?.p || t.min?.c || t.prevDay?.c || 0,
            changePercent: overrideChange,
            dayOpen: t.day?.o || t.lastTrade?.p || 0,
            prevClose: t.prevDay?.c || 0,
            type: type,
            session: currentSession,
            updatedAt: now,
            common_flag: 0,
            commonFlag: 0
        });

        // Split into gainers and losers for rank-based signals
        const snapshots = allTickersData.map(t => ({
            ...t,
            dayChg: t.todaysChangePerc || 0,
            minChg: t.min?.o > 0 ? ((t.min.c - t.min.o) / t.min.o) * 100 : 0
        }));

        const sortedByDay = [...snapshots].sort((a, b) => b.dayChg - a.dayChg);
        const sortedByMin = [...snapshots].sort((a, b) => b.minChg - a.minChg);

        // Populate Daily
        snapshots.forEach(t => {
            allMovers.push(createEntry(t, t.dayChg, t.dayChg >= 0 ? 'day_ripper' : 'day_dipper'));
        });

        // Populate 1M (Top 10 by minute velocity)
        sortedByMin.slice(0, 10).forEach(t => allMovers.push(createEntry(t, t.minChg, '1m_ripper')));
        [...sortedByMin].reverse().slice(0, 10).forEach(t => allMovers.push(createEntry(t, t.minChg, '1m_dipper')));

        // Populate 5M (Top 10 by daily strength)
        sortedByDay.slice(0, 10).forEach(t => allMovers.push(createEntry(t, t.dayChg, '5m_ripper')));
        [...sortedByDay].reverse().slice(0, 10).forEach(t => allMovers.push(createEntry(t, t.dayChg, '5m_dipper')));

        // Populate 30M (Top 5 by daily strength)
        sortedByDay.slice(0, 5).forEach(t => allMovers.push(createEntry(t, t.dayChg, '30m_ripper')));
        [...sortedByDay].reverse().slice(0, 5).forEach(t => allMovers.push(createEntry(t, t.dayChg, '30m_dipper')));

        // Create a map to count occurrences for commonality
        const tickerCounts: Record<string, number> = {};
        allMovers.forEach(m => {
            tickerCounts[m.ticker] = (tickerCounts[m.ticker] || 0) + 1;
        });

        // Set common_flag for tickers appearing in multiple categories
        allMovers.forEach(m => {
            if (tickerCounts[m.ticker] > 1) {
                m.common_flag = 1;
                m.commonFlag = 1;
            }
        });

        if (allTickersData.length === 0) {
            console.error(`[Market Service] Failed to fetch any ticker data from Polygon. Check API Key or Batch URL.`);
            return;
        }

        console.log(`[Market Service] Prepared ${allMovers.length} signals. Saving to DB...`);

        await prisma.$transaction([
            prisma.marketMover.deleteMany({}),
            prisma.marketMover.createMany({ data: allMovers })
        ]);

        console.log(`[Market Service] Sync complete.`);
    } catch (error) {
        console.error('[Market Service] Critical update failure:', error);
    }
}

export async function ensureMoversAreFresh() {
    const UPDATE_THRESHOLD_MS = 60000; // 1 minute
    try {
        const lastMover = await prisma.marketMover.findFirst({ orderBy: { updatedAt: 'desc' } });
        const now = new Date();
        if (!lastMover || (now.getTime() - new Date(lastMover.updatedAt).getTime() > UPDATE_THRESHOLD_MS)) {
            console.log('[Market Service] Triggering on-demand refresh...');
            await updateMarketMovers();
        }
    } catch (error) {
        console.error('[Market Service] Freshness check failed:', error);
    }
}
