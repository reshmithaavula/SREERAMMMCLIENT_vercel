import { prisma } from './prisma';

const POLYGON_API_KEY = process.env.POLYGON_API_KEY || process.env.API_KEY;
const BASE_URL = 'https://api.polygon.io';

async function scrapeCNBC(ticker: string): Promise<{ price: number, changePercent: number, open: number, prevClose: number }> {
    try {
        let url = `https://www.cnbc.com/quotes/${ticker}`;
        if (ticker.toUpperCase() === 'BTC' || ticker.toUpperCase() === 'BTC-USD') url = "https://www.cnbc.com/quotes/BTC.CM=";
        if (ticker.toUpperCase() === 'ETH' || ticker.toUpperCase() === 'ETH-USD') url = "https://www.cnbc.com/quotes/ETH.CM=";

        const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
            next: { revalidate: 60 }
        });
        if (!res.ok) return { price: 0, changePercent: 0, open: 0, prevClose: 0 };
        const html = await res.text();

        // Strategy 1: Look for __NEXT_DATA__ JSON
        const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
        if (nextDataMatch) {
            try {
                const data = JSON.parse(nextDataMatch[1]);
                const quote = data.props?.pageProps?.quoteData || data.props?.pageProps?.initialQuoteData;
                if (quote) {
                    let p = parseFloat(quote.last) || 0;
                    let cp = parseFloat(quote.change_pct) || 0;
                    let o = parseFloat(quote.open) || 0;
                    let pc = parseFloat(quote.previous_close) || 0;

                    // Backwards Math Fallback
                    if (pc === 0 && Math.abs(cp) > 0.0001 && p > 0) {
                        pc = p / (1 + (cp / 100));
                    }

                    return {
                        price: p,
                        changePercent: cp,
                        open: o,
                        prevClose: pc
                    };
                }
            } catch (e) {}
        }

        // Strategy 2: Improved Regex for JSON fields anywhere
        const price = parseFloat(html.match(/"price"\s*:\s*"([^"]+)"/)?.[1]?.replace(/,/g, '') || "0");
        const changePct = parseFloat(html.match(/"priceChangePercent"\s*:\s*"([^"]+)"/)?.[1]?.replace(/,/g, '') || "0");
        const open = parseFloat(html.match(/"open"\s*:\s*"([^"]+)"/)?.[1]?.replace(/,/g, '') || "0");
        let prevClose = parseFloat(html.match(/"previous_close"\s*:\s*"([^"]+)"/)?.[1]?.replace(/,/g, '') || html.match(/"closePrice"\s*:\s*"?([^",}]+)"?/)?.[1]?.replace(/,/g, '') || "0");

        if (prevClose === 0 && Math.abs(changePct) > 0.0001 && price > 0) {
            prevClose = price / (1 + (changePct / 100));
        }

        return { price, changePercent: changePct, open: open !== 0 ? open : 0, prevClose };
    } catch (e) {
        return { price: 0, changePercent: 0, open: 0, prevClose: 0 };
    }
}

// Yahoo Finance v8 Chart API - works for ETFs, OTC, and delisted stocks that CNBC misses
async function scrapeYahoo(ticker: string): Promise<{ price: number, changePercent: number, open: number, prevClose: number }> {
    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=1d`;
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'application/json'
            },
            next: { revalidate: 60 }
        });
        if (!res.ok) return { price: 0, changePercent: 0, open: 0, prevClose: 0 };
        const data = await res.json() as any;
        const meta = data?.chart?.result?.[0]?.meta;
        if (!meta || !meta.regularMarketPrice) return { price: 0, changePercent: 0, open: 0, prevClose: 0 };

        const price = meta.regularMarketPrice || 0;
        const prevClose = meta.chartPreviousClose || meta.previousClose || 0;
        const open = meta.regularMarketOpen || prevClose;
        const changePercent = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;

        return { price, changePercent, open, prevClose };
    } catch (e) {
        return { price: 0, changePercent: 0, open: 0, prevClose: 0 };
    }
}

// --- YAHOO BATCH QUOTE (NEW) ---
// Fetches up to 50 tickers in ONE call. Extremely fast for full watchlist restore.
export async function fetchBatchQuotesYahoo(tickers: string[]): Promise<Map<string, any>> {
    const results = new Map<string, any>();
    if (tickers.length === 0) return results;

    try {
        const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${tickers.join(',')}`;
        const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' },
            next: { revalidate: 60 }
        });
        if (!res.ok) return results;

        const data = await res.json() as any;
        const quotes = data?.quoteResponse?.result || [];

        quotes.forEach((q: any) => {
            if (q.symbol && (q.regularMarketPrice || q.postMarketPrice)) {
                const symbol = q.symbol.toUpperCase();
                const price = q.regularMarketPrice || q.postMarketPrice || 0;
                const prevClose = q.regularMarketPreviousClose || q.previousClose || price;
                const open = q.regularMarketOpen || q.regularMarketDayOpen || prevClose || price;
                
                results.set(symbol, {
                    price: price,
                    changePercent: q.regularMarketChangePercent || q.postMarketChangePercent || 0,
                    open: open,
                    prevClose: prevClose
                });
            }
        });
    } catch (e: any) {
        console.error("[Market Service] Yahoo Batch Failed:", e.message);
    }
    return results;
}
// --- SNAPSHOT SYNC (NEW) ---
// Fetches the entire market's top gainers and losers in ONE call.
export async function syncTopMovers() {
    if (!POLYGON_API_KEY) return;
    console.log("[Market Service] Running Global Snapshot Sync...");
    
    try {
        const endpoints = [
            `${BASE_URL}/v2/snapshot/locale/us/markets/stocks/gainers?apiKey=${POLYGON_API_KEY}`,
            `${BASE_URL}/v2/snapshot/locale/us/markets/stocks/losers?apiKey=${POLYGON_API_KEY}`
        ];

        for (const url of endpoints) {
            const res = await fetch(url);
            if (!res.ok) continue;
            const data = await res.json();
            const tickers = data.tickers || [];

            const upserts = tickers.map((t: any) => {
                const ticker = t.ticker;
                const price = t.lastTrade?.p || t.day?.c || 0;
                const changePercent = t.todaysChangePerc || 0;
                
                if (price === 0) return null;

                const type = changePercent >= 0 ? 'day_ripper' : 'day_dipper';

                return prisma.marketMover.upsert({
                    where: { ticker_type: { ticker, type } },
                    update: { 
                        price, 
                        changePercent, 
                        prevClose: t.prevDay?.c || 0,
                        updatedAt: new Date() 
                    },
                    create: { 
                        ticker, 
                        type, 
                        price, 
                        changePercent, 
                        prevClose: t.prevDay?.c || 0 
                    }
                });
            }).filter(Boolean);

            if (upserts.length > 0) {
                await Promise.all(upserts);
                console.log(`[Market Service] Snapshot Sync: Updated ${upserts.length} tickers from ${url.includes('gainers') ? 'Gainers' : 'Losers'}`);
            }
        }
    } catch (e: any) {
        console.error("[Market Service] Snapshot Sync Failed:", e.message);
    }
}

export async function updateMarketMovers(maxToProcess: number = 20, force: boolean = false) {
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
            const pennyPaths = [
                path.join(process.cwd(), '../Watchlist_Penny.csv'),
                path.join(process.cwd(), 'public/Watchlist_Penny.csv'),
                path.join(process.cwd(), 'Watchlist_Penny.csv'),
                path.join(process.cwd(), '.next/server/public/Watchlist_Penny.csv')
            ];
            let content = null;
            for (const p of pennyPaths) {
                if (fs.existsSync(p)) {
                    content = fs.readFileSync(p, 'utf-8');
                    break;
                }
            }
            if (content) {
                const lines = content.split('\n').filter(l => l.trim().length > 0).slice(1);
                lines.forEach(line => {
                    const t = line.split(',')[1]?.trim().toUpperCase();
                    if (t && !tickers.includes(t)) tickers.push(t);
                });
            }

            // Also include legacy Watchlist_New.csv
            const legacyPaths = [
                path.join(process.cwd(), '../Watchlist_New.csv'),
                path.join(process.cwd(), 'public/Watchlist_New.csv'),
                path.join(process.cwd(), 'Watchlist_New.csv'),
                path.join(process.cwd(), '.next/server/public/Watchlist_New.csv')
            ];
            let legacyContent = null;
            for (const p of legacyPaths) {
                if (fs.existsSync(p)) {
                    legacyContent = fs.readFileSync(p, 'utf-8');
                    break;
                }
            }
            if (legacyContent) {
                const lines = legacyContent.split('\n').filter(l => l.trim().length > 0).slice(1);
                lines.forEach(line => {
                    const t = line.split(',')[1]?.trim().toUpperCase();
                    if (t && !tickers.includes(t)) tickers.push(t);
                });
            }
        } catch (e) { }


        if (tickers.length === 0) return { success: true, message: 'No tickers to sync' };

        // Check which ones need an update (older than 6 hours)
        // We use 6 hours so a full 2-hour manual sync can finish without looping
        const windowAgo = new Date(Date.now() - 3 * 60 * 1000);
        const freshMovers = await prisma.marketMover.findMany({
            where: {
                ticker: { in: tickers },
                updatedAt: { gt: windowAgo },
                price: { gt: 0.1 } // Real prices only
            },
            select: { ticker: true }
        });
        const freshTickers = force ? new Set() : new Set(freshMovers.map(m => m.ticker));
        let pendingTickers = tickers.filter(t => !freshTickers.has(t));

        // PRIORITIZATION: Prioritize "Common" and "Penny" tickers
        const commonPriority = ['AAPL', 'AMZN', 'GOOG', 'GOOGL', 'META', 'MSFT', 'NVDA', 'TSLA', 'AMD', 'SPY', 'QQQ', 'BTC-USD', 'ETH-USD', 'BTC', 'ETH', 'CHPT', 'IREN', 'DNA', 'GME', 'AMC', 'WISH'];

        pendingTickers.sort((a, b) => {
            const aNorm = (['BTC', 'ETH'].includes(a) ? `${a}-USD` : a);
            const bNorm = (['BTC', 'ETH'].includes(b) ? `${b}-USD` : b);

            const aIsCommon = commonPriority.includes(aNorm) || commonPriority.includes(a) ? 1 : 0;
            const bIsCommon = commonPriority.includes(bNorm) || commonPriority.includes(b) ? 1 : 0;
            return bIsCommon - aIsCommon;
        });

        // Limit the batch
        pendingTickers = pendingTickers.slice(0, maxToProcess);

        if (pendingTickers.length === 0) {
            return { success: true, message: 'All tickers already fresh' };
        }

        console.log(`[Market Service] Batch Sync: Processing ${pendingTickers.length} out of ${tickers.length} remaining tickers...`);

        const allTickersData: any[] = [];
        // Efficiently fetch existing data for the whole batch
        const existingMovers = await prisma.marketMover.findMany({
            where: { ticker: { in: pendingTickers } }
        });
        const existingMap = new Map(existingMovers.map(m => [m.ticker, m]));

        console.log(`[Market Service] Batch Sync: Fetching ${pendingTickers.length} tickers via Yahoo Batch...`);
        
        // Split tickers into chunks of 40 to avoid URL length issues
        const chunkSize = 40;
        for (let i = 0; i < pendingTickers.length; i += chunkSize) {
            const chunk = pendingTickers.slice(i, i + chunkSize);
            const batchResults = await fetchBatchQuotesYahoo(chunk);

            for (const ticker of chunk) {
                let q = batchResults.get(ticker);
                const existing = existingMap.get(ticker);

                // --- FALLBACK: If Batch failed, try individual scrape ---
                if (!q || q.price <= 0.1) {
                    console.log(`[Market Service] Batch missed ${ticker}. Trying individual fallbacks...`);
                    const individual = await scrapeYahoo(ticker);
                    if (individual.price > 0.1) {
                        q = individual;
                    } else {
                        const cnbc = await scrapeCNBC(ticker);
                        if (cnbc.price > 0.1) q = cnbc;
                    }
                }

                if (q && q.price > 0.1) {
                    allTickersData.push({
                        ticker: ticker,
                        price: q.price,
                        changePerc: q.changePercent,
                        prevClose: q.prevClose || existing?.prevClose || q.price,
                        dayOpen: q.open || existing?.dayOpen || q.price
                    });
                    console.log(`[Market Service] Recovered ${ticker}: $${q.price}`);
                } else if (existing) {
                    // Heartbeat for existing records that failed to fetch
                    allTickersData.push({ ticker, isHeartbeat: true });
                } else {
                    // Initialize empty records
                    allTickersData.push({
                        ticker,
                        price: 0.0001,
                        changePerc: 0,
                        prevClose: 0.0001,
                        dayOpen: 0.0001
                    });
                }
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
                if (t.isHeartbeat) {
                    const updateData: any = { updatedAt: now };
                    // Heal broken zero-value records retroactively so they stop blocking the queue
                    if (t.needsHealing) {
                        updateData.price = 0.0001;
                        updateData.dayOpen = 0.0001;
                        updateData.prevClose = 0.0001;
                    }
                    await tx.marketMover.updateMany({
                        where: { ticker: t.ticker },
                        data: updateData
                    });
                    continue;
                }

                const isCommon = ['AAPL', 'AMZN', 'GOOG', 'GOOGL', 'META', 'MSFT', 'NVDA', 'TSLA', 'AMD', 'SPY', 'QQQ', 'BTC', 'ETH', 'BTC-USD', 'ETH-USD', 'COIN', 'NFLX', 'PYPL', 'ADBE', 'TSMC', 'ARM', 'SMCI', 'AVGO', 'ASML', 'MSTR', 'MARA', 'RIOT', 'GME', 'AMC'].includes(t.ticker.toUpperCase());

                const mover = {
                    ticker: t.ticker,
                    price: t.price || 0.0001,
                    changePercent: t.changePerc || 0,
                    dayOpen: t.dayOpen || 0.0001,
                    prevClose: t.prevClose || 0.0001,
                    type: isCommon
                        ? (t.changePerc >= 0 ? 'day_ripper' : 'day_dipper')
                        : (t.changePerc > 0 ? 'day_ripper' : (t.changePerc < 0 ? 'day_dipper' : 'neutral')),
                    session: currentSession,
                    updatedAt: now,
                    commonFlag: isCommon ? 1 : 0,
                    common_flag: isCommon ? 1 : 0
                };

                // REVERT TO DELETE/CREATE: This is the ONLY way to ensure only ONE record exists for a ticker
                // if it switches types (e.g. from 'neutral' to 'day_ripper').
                // Upsert on 'ticker_type' would create a second record!
                await tx.marketMover.deleteMany({
                    where: { ticker: mover.ticker }
                });

                await tx.marketMover.create({
                    data: mover
                });
            }
        });

        return {
            success: true,
            message: `Batch sync complete: ${allTickersData.filter(d => !d.isHeartbeat).length} records updated. ${pendingTickers.length - allTickersData.length} remaining in this pass.`,
            remaining: Math.max(0, tickers.length - (freshTickers.size + allTickersData.filter(d => !d.isHeartbeat).length))
        };
    } catch (error: any) {
        console.error('[Market Service] Sync failure:', error);
        return { success: false, message: error.message };
    }
}

// Global debounce variable for Serverless environments (lives as long as the Vercel function instance)
let isSyncing = false;
let lastSyncGlobal = 0;
const SYNC_COOLDOWN_MS = 180 * 1000; // 3 minutes - requested by user and avoids Prisma plan limits

export async function ensureMoversAreFresh() {
    const now = Date.now();

    // 1. FAST MEMORY CHECK (Vercel warm start)
    if (isSyncing || (now - lastSyncGlobal) < SYNC_COOLDOWN_MS) {
        return;
    }

    try {
        isSyncing = true;

        // 2. DATABASE CHECK (For cold starts where memory was wiped)
        const recentMover = await prisma.marketMover.findFirst({
            orderBy: { updatedAt: 'desc' }
        });

        if (recentMover && (now - recentMover.updatedAt.getTime()) < SYNC_COOLDOWN_MS) {
            lastSyncGlobal = recentMover.updatedAt.getTime();
            isSyncing = false;
            return;
        }

        console.log(`[Lazy Sync] Triggering background updateMarketMovers. (Last DB update: ${recentMover?.updatedAt ? new Date(recentMover.updatedAt).toLocaleTimeString() : 'Never'})`);

        // Let it run synchronously so the *current* request gets fresher data,
        const allWatchlist = await prisma.watchlist.findMany({ select: { ticker: true } });
        const allTickers = allWatchlist.map(w => w.ticker);
        
        // Find how many are stale
        const windowAgo = new Date(Date.now() - 15 * 60 * 1000);
        const freshMovers = await prisma.marketMover.count({
            where: {
                ticker: { in: allTickers },
                updatedAt: { gt: windowAgo },
                price: { gt: 0.1 }
            }
        });

        // ADAPTIVE BATCH SIZE: If more than 30% of the watchlist is stale, sync EVERYTHING (max 350)
        // This ensures the "233 stocks" problem is fixed in one pass.
        const staleCount = allTickers.length - freshMovers;
        const adaptiveBatchSize = staleCount > (allTickers.length * 0.3) ? Math.min(allTickers.length, 350) : 100;
        
        console.log(`[Market Service] Health Check: ${freshMovers}/${allTickers.length} fresh. Syncing ${adaptiveBatchSize} tickers...`);

        // --- STEP 1: GLOBAL SNAPSHOT (Instant Rippers/Dippers) ---
        await syncTopMovers();

        // --- STEP 2: BATCH UPDATE (Individual Watchlist Items) ---
        await updateMarketMovers(adaptiveBatchSize, false);

        lastSyncGlobal = Date.now();
        (global as any).lastMoverUpdate = new Date().toISOString();
    } catch (e: any) {
        console.error('[Lazy Sync] Failed:', e.message);
    } finally {
        isSyncing = false;
    }
}
