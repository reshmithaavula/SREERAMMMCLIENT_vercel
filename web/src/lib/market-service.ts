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

                return prisma.marketMover.upsert({
                    where: { ticker_type: { ticker, type: 'day' } },
                    update: { 
                        price, 
                        changePercent, 
                        prevClose: t.prevDay?.c || 0,
                        updatedAt: new Date() 
                    },
                    create: { 
                        ticker, 
                        type: 'day', 
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
                price: { gt: 0.001 },      // Exclude 0.0001 placeholders
                dayOpen: { gt: 0.001 },    // Exclude 0.0001 placeholders
                prevClose: { gt: 0.001 }   // Exclude 0.0001 placeholders
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

        console.log(`[Market Service] Using individual fetching for ${pendingTickers.length} tickers...`);
        for (const ticker of pendingTickers) {
            try {
                const isCrypto = ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOGE'].includes(ticker) || ticker.includes('-USD');
                const normTicker = (isCrypto && !ticker.includes('-')) ? `${ticker}-USD` : ticker;

                const existing = existingMap.get(ticker);

                // 1. Get Prev Close (Stocks Only for now, Polygon Free Aggs for Crypto is tricky)
                let prevClose = 0;
                if (!isCrypto) {
                    const prevUrl = `${BASE_URL}/v2/aggs/ticker/${normTicker}/prev?adjusted=true&apiKey=${POLYGON_API_KEY}`;
                    const prevRes = await fetch(prevUrl);
                    if (prevRes.ok) {
                        const prevData = await prevRes.json();
                        prevClose = prevData.results?.[0]?.c || 0;
                    }
                }

                // 2. Get Last Trade (Current Price)
                let lastPrice = 0;
                let tradeRes;
                if (isCrypto) {
                    const [base, quote] = normTicker.split('-');
                    const tradeUrl = `${BASE_URL}/v1/last/crypto/${base}/${quote}?apiKey=${POLYGON_API_KEY}`;
                    try {
                        tradeRes = await fetch(tradeUrl);
                        if (tradeRes.ok) {
                            const tradeData = await tradeRes.json();
                            lastPrice = tradeData.last?.price || 0;
                            if (prevClose === 0) prevClose = lastPrice;
                        }
                    } catch (e) {}
                } else {
                    const tradeUrl = `${BASE_URL}/v1/last/stocks/${normTicker}?apiKey=${POLYGON_API_KEY}`;
                    try {
                        tradeRes = await fetch(tradeUrl);
                        if (tradeRes.ok) {
                            const tradeData = await tradeRes.json();
                            lastPrice = tradeData.last?.price || tradeData.last?.p || 0;
                        }
                    } catch (e) {}
                }

                let cnbcData: any = null;

                // --- YAHOO FINANCE FALLBACK (PRIMARY FALLBACK, HIGH ACCURACY JSON) ---
                if (lastPrice === 0 || prevClose === 0 || tradeRes?.status === 403 || tradeRes?.status === 429) {
                    console.log(`[Market Service] Polygon failed/limited for ${ticker}. Trying Yahoo Finance...`);
                    const yahooData = await scrapeYahoo(ticker);
                    if (yahooData.price > 0) {
                        lastPrice = yahooData.price;
                        if (yahooData.prevClose > 0) prevClose = yahooData.prevClose;
                        cnbcData = { open: yahooData.open, changePercent: yahooData.changePercent, prevClose: yahooData.prevClose };
                        console.log(`[Market Service] Yahoo Rescue for ${ticker}: ${lastPrice} (Prev: ${prevClose})`);
                    }
                }

                // --- CNBC FALLBACK (LAST RESORT, REGEX SCRAPING) ---
                if (lastPrice === 0 || prevClose === 0) {
                    console.log(`[Market Service] Yahoo failed for ${ticker}. Trying CNBC...`);
                    cnbcData = await scrapeCNBC(ticker);
                    if (cnbcData.price > 0) {
                        lastPrice = cnbcData.price;
                        if (cnbcData.prevClose > 0) prevClose = cnbcData.prevClose;
                        else if (prevClose === 0) prevClose = lastPrice / (1 + (cnbcData.changePercent / 100));
                        
                        console.log(`[Market Service] CNBC Rescue for ${ticker}: ${lastPrice} (Prev: ${prevClose})`);
                    }
                }


                if (tradeRes?.status === 429 && lastPrice === 0) {
                    console.warn(`[Market Service] Pure Rate limit (429) hit. Stopping batch.`);
                    break;
                }

                // ONLY UPDATE IF WE FOUND A REAL PRICE (> 0)
                if (lastPrice > 0) {
                    // Priority for dayOpen: CNBC exact > prevClose (from Polygon/CNBC) > lastPrice
                    let dayOpen = lastPrice;
                    if (cnbcData?.open > 0) dayOpen = cnbcData.open;
                    else if (prevClose > 0) dayOpen = prevClose;

                    let changePerc = cnbcData?.changePercent || 0;

                    let finalPrevClose = prevClose;
                    if (finalPrevClose === 0 && (existing?.prevClose || 0) > 0) {
                        finalPrevClose = existing!.prevClose!;
                    } else if (finalPrevClose === 0) {
                        if (Math.abs(changePerc) > 0.0001 && lastPrice > 0) {
                            finalPrevClose = lastPrice / (1 + (changePerc / 100));
                        } else {
                            finalPrevClose = lastPrice;
                        }
                    }

                    let finalDayOpen = dayOpen;
                    if (finalDayOpen === lastPrice && (existing?.dayOpen || 0) > 0) {
                        finalDayOpen = existing!.dayOpen!;
                    } else if (finalDayOpen === 0) {
                        finalDayOpen = lastPrice;
                    }

                    // Recalculate change percent if we have a real baseline but change is 0
                    if (Math.abs(changePerc) < 0.0001 && finalPrevClose > 0 && Math.abs(lastPrice - finalPrevClose) > 0.0001) {
                        changePerc = ((lastPrice - finalPrevClose) / finalPrevClose) * 100;
                    }

                    allTickersData.push({
                        ticker: ticker,
                        price: lastPrice,
                        changePerc: changePerc,
                        prevClose: finalPrevClose,
                        dayOpen: finalDayOpen
                    });
                    console.log(`[Market Service] Sync'd ${ticker}: $${lastPrice} (OCHG: ${((lastPrice - finalDayOpen) / finalDayOpen * 100).toFixed(2)}%)`);
                } else if (existing) {
                    // If it's an existing record but we still can't get a price,
                    // we must ensure it doesn't have exactly '0' blocking the freshMovers check.
                    allTickersData.push({
                        ticker: ticker,
                        isHeartbeat: true,
                        needsHealing: (existing.price === 0 || existing.dayOpen === 0 || existing.prevClose === 0)
                    });
                } else {
                    // Initialize empty record to prevent infinite loop of "stale" un-synced tickers
                    allTickersData.push({
                        ticker: ticker,
                        price: 0.0001, // Store a tiny fraction so it counts as initialized
                        changePerc: 0,
                        prevClose: 0.0001,
                        dayOpen: 0.0001
                    });
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

                const isCommon = ['AAPL', 'AMZN', 'GOOG', 'GOOGL', 'META', 'MSFT', 'NVDA', 'TSLA', 'AMD', 'SPY', 'QQQ', 'BTC', 'ETH', 'BTC-USD', 'ETH-USD', 'COIN', 'NFLX', 'PYPL', 'ADBE'].includes(t.ticker.toUpperCase());

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
        // but limit the batch size to 20 to keep the request fast (< 5s).
        // --- STEP 1: GLOBAL SNAPSHOT (Instant Rippers/Dippers) ---
        await syncTopMovers();

        // --- STEP 2: BATCH UPDATE (Individual Watchlist Items) ---
        await updateMarketMovers(15, false);

        lastSyncGlobal = Date.now();
    } catch (e: any) {
        console.error('[Lazy Sync] Failed:', e.message);
    } finally {
        isSyncing = false;
    }
}
