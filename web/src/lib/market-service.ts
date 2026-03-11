import { prisma } from './prisma';

const POLYGON_API_KEY = process.env.POLYGON_API_KEY || process.env.API_KEY;
const BASE_URL = 'https://api.polygon.io';

async function scrapeCNBC(ticker: string): Promise<{ price: number, changePercent: number }> {
    try {
        const isCrypto = ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOGE'].includes(ticker.toUpperCase()) || ticker.includes('-USD');
        let url = `https://www.cnbc.com/quotes/${ticker}`;
        if (ticker.toUpperCase() === 'BTC' || ticker.toUpperCase() === 'BTC-USD') url = "https://www.cnbc.com/quotes/BTC.CM=";
        if (ticker.toUpperCase() === 'ETH' || ticker.toUpperCase() === 'ETH-USD') url = "https://www.cnbc.com/quotes/ETH.CM=";

        const res = await fetch(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
            next: { revalidate: 60 }
        });
        if (!res.ok) return { price: 0, changePercent: 0 };
        const html = await res.text();
        const priceMatch = html.match(/"price"\s*:\s*"([^"]+)"/);
        const changePctMatch = html.match(/"priceChangePercent"\s*:\s*"([^"]+)"/);
        
        let price = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : 0;
        let changePct = changePctMatch ? parseFloat(changePctMatch[1].replace(/,/g, '')) : 0;
        
        return { price, changePercent: changePct };
    } catch (e) {
        return { price: 0, changePercent: 0 };
    }
}

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

        // Check which ones need an update (older than 6 hours)
        // We use 6 hours so a full 2-hour manual sync can finish without looping
        const windowAgo = new Date(Date.now() - 360 * 60 * 1000);
        const freshMovers = await prisma.marketMover.findMany({
            where: { 
                ticker: { in: tickers },
                updatedAt: { gt: windowAgo },
                price: { gt: 0 } 
            },
            select: { ticker: true }
        });
        const freshTickers = new Set(freshMovers.map(m => m.ticker));
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

                // --- CNBC FALLBACK (RESILIENCY UPGRADE) ---
                if (lastPrice === 0 || tradeRes?.status === 403 || tradeRes?.status === 429) {
                    console.log(`[Market Service] Polygon failed/limited for ${ticker}. Trying CNBC...`);
                    const cnbcData = await scrapeCNBC(ticker);
                    if (cnbcData.price > 0) {
                        lastPrice = cnbcData.price;
                        if (prevClose === 0) prevClose = lastPrice / (1 + (cnbcData.changePercent / 100));
                        console.log(`[Market Service] CNBC Rescue for ${ticker}: $${lastPrice}`);
                    }
                }

                if (tradeRes?.status === 429 && lastPrice === 0) {
                    console.warn(`[Market Service] Pure Rate limit (429) hit. Stopping batch.`);
                    break;
                }

                // ONLY UPDATE IF WE FOUND A REAL PRICE (> 0)
                if (lastPrice > 0) {
                    const changePerc = (prevClose > 0 && prevClose !== lastPrice) ? ((lastPrice - prevClose) / prevClose) * 100 : 0;
                    
                    allTickersData.push({
                        ticker: ticker,
                        price: lastPrice,
                        changePerc: changePerc,
                        prevClose: prevClose > 0 ? prevClose : lastPrice,
                        dayOpen: prevClose > 0 ? prevClose : lastPrice
                    });
                    console.log(`[Market Service] Sync'd ${ticker}: $${lastPrice} (${changePerc.toFixed(2)}%) Prev: $${prevClose.toFixed(2)}`);
                } else {
                    allTickersData.push({
                        ticker: ticker,
                        isHeartbeat: true
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
            message: `Batch sync complete: ${allTickersData.filter(d => !d.isHeartbeat).length} records updated. ${pendingTickers.length - allTickersData.length} remaining in this pass.`,
            remaining: Math.max(0, tickers.length - (freshTickers.size + allTickersData.filter(d => !d.isHeartbeat).length))
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
