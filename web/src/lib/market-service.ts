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
        let pendingTickers = tickers.filter(t => !freshTickers.has(t));

        // PRIORITIZATION: Prioritize "Common" and "Penny" tickers
        const commonPriority = ['AAPL', 'AMZN', 'GOOG', 'GOOGL', 'META', 'MSFT', 'NVDA', 'TSLA', 'AMD', 'SPY', 'QQQ', 'BTC-USD', 'ETH-USD', 'BTC', 'ETH'];

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

        console.log(`[Market Service] Using individual fetching for ${pendingTickers.length} tickers...`);
        for (const ticker of pendingTickers) {
            try {
                const isCrypto = ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOGE'].includes(ticker) || ticker.includes('-USD');
                const normTicker = (isCrypto && !ticker.includes('-')) ? `${ticker}-USD` : ticker;

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
                    tradeRes = await fetch(tradeUrl);
                    if (tradeRes.ok) {
                        const tradeData = await tradeRes.json();
                        lastPrice = tradeData.last?.price || 0;
                        if (prevClose === 0) prevClose = lastPrice; // Crypto fallback
                    }
                } else {
                    const tradeUrl = `${BASE_URL}/v1/last/stocks/${normTicker}?apiKey=${POLYGON_API_KEY}`;
                    tradeRes = await fetch(tradeUrl);
                    if (tradeRes.ok) {
                        const tradeData = await tradeRes.json();
                        lastPrice = tradeData.last?.price || tradeData.last?.p || 0;
                    }
                }

                if (tradeRes?.status === 429) {
                    console.warn(`[Market Service] Rate limit (429) hit at ${ticker}. Stopping batch.`);
                    break;
                }

                // ONLY UPDATE IF WE FOUND A REAL PRICE (> 0)
                if (lastPrice > 0) {
                    // Calculate change ONLY if we have a valid prevClose that isn't the same as lastPrice
                    // If we don't have a valid prevClose, we keep the price but 0% change
                    const changePerc = (prevClose > 0 && prevClose !== lastPrice) ? ((lastPrice - prevClose) / prevClose) * 100 : 0;
                    
                    allTickersData.push({
                        ticker: ticker, // Keep original ticker for DB lookup
                        price: lastPrice,
                        changePerc: changePerc,
                        prevClose: prevClose > 0 ? prevClose : lastPrice,
                        dayOpen: prevClose > 0 ? prevClose : lastPrice
                    });
                    console.log(`[Market Service] Sync'd ${ticker}: $${lastPrice} (${changePerc.toFixed(2)}%)`);
                } else {
                    // Even if we skip the data update, we create a "heartbeat" to move the sync forward
                    allTickersData.push({
                        ticker: ticker,
                        isHeartbeat: true
                    });
                    console.warn(`[Market Service] ${ticker} no price data found. Skipping but touching heartbeat.`);
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
                    // Only touch updatedAt if they already have a valid price.
                    // If price is 0, we WANT them to stay "stale" so they are retried immediately.
                    const current = await tx.marketMover.findFirst({
                        where: { ticker: t.ticker, price: { gt: 0 } }
                    });
                    
                    if (current) {
                        await tx.marketMover.updateMany({
                            where: { ticker: t.ticker },
                            data: { updatedAt: now }
                        });
                    }
                    continue;
                }

                const isCommon = ['AAPL', 'AMZN', 'GOOG', 'GOOGL', 'META', 'MSFT', 'NVDA', 'TSLA', 'AMD', 'SPY', 'QQQ', 'BTC', 'ETH', 'BTC-USD', 'ETH-USD', 'COIN', 'NFLX', 'PYPL', 'ADBE'].includes(t.ticker.toUpperCase());

                const mover = {
                    ticker: t.ticker,
                    price: t.price,
                    changePercent: t.changePerc,
                    dayOpen: t.dayOpen,
                    prevClose: t.prevClose,
                    // Priority Visibility: If common stock, force into ripper/dipper lists even if 0% change
                    type: isCommon 
                        ? (t.changePerc >= 0 ? 'day_ripper' : 'day_dipper')
                        : (t.changePerc > 0 ? 'day_ripper' : (t.changePerc < 0 ? 'day_dipper' : 'neutral')),
                    session: currentSession,
                    updatedAt: now,
                };

                const finalMover = {
                    ...mover,
                    commonFlag: isCommon ? 1 : 0,
                    common_flag: isCommon ? 1 : 0
                };

                try {
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
