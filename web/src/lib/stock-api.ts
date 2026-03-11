// @ts-ignore
import { prisma } from './prisma';
import { unstable_cache } from 'next/cache';
// No fallback imports - we only show real data now


const BASE_URL = 'https://api.polygon.io';

export const dynamic = 'force-dynamic';

export interface LiveQuote {
    ticker: string;
    price: number;
    change: number;
    changePercent: number;
    volume?: number;
    openPrice?: number;
    prevClose?: number;
    lastUpdated?: number;
}

// Timeout wrapper for fetch calls
async function fetchWithTimeout(url: string, timeoutMs: number = 10000): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        throw error;
    }
}



// Internal fetcher that does the actual work
async function fetchLiveQuotesInternal(tickers: string[]): Promise<Record<string, LiveQuote>> {
    const results: Record<string, LiveQuote> = {};
    const POLYGON_API_KEY = process.env.POLYGON_API_KEY;

    if (!POLYGON_API_KEY) {
        console.error('POLYGON_API_KEY is not defined');
        return results;
    }

    try {
        const isCrypto = (t: string) => ['BTC', 'ETH', 'SOL', 'XRP', 'ADA', 'DOGE'].includes(t.toUpperCase()) || t.includes('-');
        const cryptoTickers = tickers.filter(t => isCrypto(t));
        const stockTickers = tickers.filter(t => !isCrypto(t));

        // --- 1. PRE-FETCH FROM DATABASE (Save Quota) ---
        if (tickers.length > 0) {
            const twoHoursAgo = new Date(Date.now() - 120 * 60 * 1000);
            const dbMovers = await prisma.marketMover.findMany({
                where: {
                    ticker: { in: tickers },
                    updatedAt: { gt: twoHoursAgo }
                }
            });

            dbMovers.forEach(m => {
                if ((m.price || 0) > 0) {
                    results[m.ticker] = {
                        ticker: m.ticker,
                        price: m.price || 0,
                        change: m.changePercent || 0,
                        changePercent: m.changePercent || 0,
                        openPrice: m.dayOpen || 0,
                        prevClose: m.prevClose || 0,
                        lastUpdated: m.updatedAt.getTime()
                    };
                }
            });
            const validHits = Object.keys(results).length;
            console.log(`[Stock API] DB found ${validHits}/${stockTickers.length} tickers with valid prices.`);
        }

        const tickersToFetch = stockTickers.filter(t => !results[t]);
        const promises: Promise<any>[] = [];

        // --- 2. FETCH CRYPTO (DISABLED - Use /api/sync) ---
        /*
           Crypto fetching is also disabled to preserve the 5-calls/min quota.
        */
        if (cryptoTickers.length > 0) {
            tickersToFetch.push(...cryptoTickers);
        }

        // --- 3. FETCH STOCKS (DISABLED - Use /api/sync) ---
        /* 
           We disable live stock fetching here because the Free Tier (5 calls/min) 
           is easily exhausted by page refreshes. Data should be populated via /api/sync.
        */
        if (tickersToFetch.length > 0) {
            console.log(`[Stock API] ${tickersToFetch.length} tickers not in DB. Showing 0 (Needs Sync).`);
        }

        await Promise.all(promises);

    } catch (error) {
        console.error('Error in fetchLiveQuotesInternal:', error);
    }

    return results;
}

interface QuotesCache {
    data: Record<string, LiveQuote>;
    timestamp: number;
}
declare global {
    var quotesCache: QuotesCache | undefined;
    var polygonSnapshotBlockedUntil: number | undefined;
}

export async function getLiveQuotes(tickers: string[]): Promise<Record<string, LiveQuote>> {
    const CACHE_DURATION = 60000; // 60 seconds (Save Quota)
    const now = Date.now();

    // Simple cache check
    if (globalThis.quotesCache) {
        const age = now - globalThis.quotesCache.timestamp;
        const cached = globalThis.quotesCache.data;
        const allPresent = tickers.every(t => cached[t]);

        // Return cached data if fresh and complete
        if (allPresent && age < CACHE_DURATION) {
            console.log(`[Cache HIT] Returning cached data (age: ${age}ms)`);
            return cached;
        }
    }

    // Search DB
    console.log(`[DB Search] Searching for ${tickers.length} tickers in database`);
    const results = await fetchLiveQuotesInternal(tickers);

    // Update global cache
    globalThis.quotesCache = {
        data: { ...(globalThis.quotesCache?.data || {}), ...results },
        timestamp: now
    };

    return results;
}

export async function getLiveQuote(ticker: string): Promise<LiveQuote | null> {
    const quotes = await getLiveQuotes([ticker]);
    return quotes[ticker] || null;
}

// Ensure this matches the backend engine's types
// --- WATCHLIST CACHING ---
let cachedWatchlist: string[] = [];
let lastWatchlistRead = 0;
const WATCHLIST_CACHE_TTL = 10000; // 10 seconds

export async function getWatchlistTickers(): Promise<string[]> {
    const now = Date.now();
    if (cachedWatchlist.length > 0 && (now - lastWatchlistRead < WATCHLIST_CACHE_TTL)) {
        return cachedWatchlist;
    }

    const possiblePaths = [
        path.join(process.cwd(), '../Watchlist_New.csv'),
        path.join(process.cwd(), 'public/Watchlist_New.csv'),
        path.join(process.cwd(), 'Watchlist_New.csv'),
        path.join(process.cwd(), '.next/server/public/Watchlist_New.csv')
    ];

    try {
        for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
                const fileContent = fs.readFileSync(p, 'utf-8');
                const lines = fileContent.split('\n');
                const tickers: string[] = [];
                for (let i = 1; i < lines.length; i++) {
                    const parts = lines[i].split(',');
                    if (parts.length > 1) {
                        const t = parts[1]?.trim();
                        if (t) tickers.push(t);
                    }
                }
                if (tickers.length > 0) {
                    cachedWatchlist = tickers;
                    lastWatchlistRead = now;
                    return tickers;
                }
            }
        }
    } catch (e) {
        console.error("Error reading watchlist:", e);
    }
    return cachedWatchlist;
}

export async function getRealTimeMovers(timeframe: '1m' | '5m' | '30m' | 'day' = 'day'): Promise<{ rippers: any[], dippers: any[] }> {
    const prefix = timeframe === 'day' ? 'day' : timeframe;
    const ripType = `${prefix}_ripper`;
    const dipType = `${prefix}_dipper`;

    const tickers = await getWatchlistTickers();
    if (tickers.length === 0) return { rippers: [], dippers: [] };

    try {
        const rows = await prisma.marketMover.findMany({
            where: {
                type: { in: [ripType, dipType] },
                ticker: { in: tickers }
            },
            orderBy: {
                changePercent: 'desc'
            }
        });

        const rippers = rows.filter(r => (r.changePercent || 0) > 0).slice(0, 50);
        const dippers = rows.filter(r => (r.changePercent || 0) < 0).sort((a, b) => (a.changePercent || 0) - (b.changePercent || 0)).slice(0, 50);

        return {
            rippers: rippers.map(r => ({ ...r, change_percent: r.changePercent })),
            dippers: dippers.map(r => ({ ...r, change_percent: r.changePercent }))
        };
    } catch (e) {
        console.error('Error reading movers from Prisma:', e);
        return { rippers: [], dippers: [] };
    }
}

export async function getMarketMovers(limit: number = 5): Promise<{ gainers: LiveQuote[], losers: LiveQuote[] }> {
    const { rippers, dippers } = await getRealTimeMovers('day');
    return {
        gainers: rippers.slice(0, limit),
        losers: dippers.slice(0, limit)
    };
}

// --- PENNY STOCK LOGIC ---
export async function getPennyStocks(limit: number = 200): Promise<any[]> {
    const CACHE_DURATION = 5000; // 5 seconds
    const now = Date.now();

    if (globalThis.pennyCache && (now - globalThis.pennyCache.timestamp < CACHE_DURATION)) {
        return globalThis.pennyCache.data;
    }

    // Check Cache (using a separate cache for penny stocks if needed, or just leverage same mechanism)
    // For simplicity, we'll just fetch for now or use a dedicated global cache

    try {
        const csvPath = path.join(process.cwd(), '../Watchlist_Penny.csv');
        if (!fs.existsSync(csvPath)) {
            console.error(`Penny Watchlist CSV not found at ${csvPath}`);
            return [];
        }

        const fileContent = fs.readFileSync(csvPath, 'utf-8');
        const lines = fileContent.split('\n').filter(line => line.trim() !== '');

        // CSV Header: Category,Ticker,ConvictionStocks,DecidingTheMarketDirections,DollarMoves
        // Ticker is index 1
        const tickerData = lines.slice(1).map(line => {
            const parts = line.split(',');
            const category = parts[0]?.trim();
            const ticker = parts[1]?.trim();
            return { ticker, category };
        }).filter(t => t.ticker && t.ticker.length > 0);

        const uniqueTickers = Array.from(new Set(tickerData.map(d => (d.ticker || '').toUpperCase())));
        const quotes = await getLiveQuotes(uniqueTickers);

        // Fetch Momentum from DB to augment
        const momentumMap: Record<string, any> = {};
        try {
            const movers = await prisma.marketMover.findMany({
                where: {
                    ticker: { in: uniqueTickers }
                }
            });

            movers.forEach(m => {
                if (!momentumMap[m.ticker]) momentumMap[m.ticker] = {};
                momentumMap[m.ticker][m.type] = m.changePercent;
            });
        } catch (e) {
            console.warn("[PennyAPI] Prisma Momentum fetch failed, continuing with live quotes only");
        }

        const result = tickerData.map((data, i) => {
            const ticker = (data.ticker || '').toUpperCase();
            // Preserve existing data from cache if live quotes missing this ticker
            const cachedQuote = globalThis.quotesCache?.data?.[ticker];
            const quote = quotes[ticker] || cachedQuote || {
                ticker: ticker,
                price: 0,
                change: 0,
                changePercent: 0,
                volume: 0,
                openPrice: 0,
                prevClose: 0,
                lastUpdated: Date.now()
            };

            const momentum = momentumMap[ticker] || {};

            return {
                ...quote,
                category: data.category,
                rank: i + 1,
                momentum1m: momentum['1m_ripper'] || momentum['1m_dipper'] || 0,
                momentum5m: momentum['5m_ripper'] || momentum['5m_dipper'] || 0,
                momentum30m: momentum['30m_ripper'] || momentum['30m_dipper'] || 0,
                momentumDay: momentum['day_ripper'] || momentum['day_dipper'] || quote.changePercent || 0,
                openPrice: quote.openPrice || 0,
                prevClose: quote.prevClose || 0,
                lastUpdated: quote.lastUpdated || Date.now()
            };
        });

        globalThis.pennyCache = {
            data: result,
            timestamp: now
        };

        return result;

    } catch (error) {
        console.error('Error reading Penny Watchlist CSV:', error);
        return [];
    }
}

declare global {
    var pennyCache: { data: any[], timestamp: number } | undefined;
    var portfolioCache: { data: any[], timestamp: number } | undefined;
}

import * as fs from 'fs';
import * as path from 'path';

export async function getMomentumStocks(limit: number = 50): Promise<any[]> {
    // Legacy support or fallback if needed, but we typically redirect to getCSVWatchlistStocks
    // for the main watchlist now.
    return getCSVWatchlistStocks(limit);
}

// Cache structure
interface WatchlistCache {
    data: any[];
    timestamp: number;
}
// Add to globalThis to persist across hot reloads in dev
declare global {
    var watchlistCache: WatchlistCache | undefined;
}



export async function getCSVWatchlistStocks(limit: number = 200): Promise<any[]> {
    const CACHE_DURATION = 3000; // 3 seconds
    const now = Date.now();

    // Check Cache
    if (globalThis.watchlistCache && (now - globalThis.watchlistCache.timestamp < CACHE_DURATION)) {
        return globalThis.watchlistCache.data;
    }

    try {
        // Primary Source: Prisma Watchlist table
        const dbTickers = await prisma.watchlist.findMany({
            select: { ticker: true, category: true }
        });

        let tickerData = dbTickers.map(r => ({
            category: r.category || 'User Added',
            ticker: r.ticker
        }));

        // Fallback/Legacy Source: CSV (if available)
        try {
            const csvPath = path.join(process.cwd(), '../Watchlist_New.csv');
            if (fs.existsSync(csvPath)) {
                const fileContent = fs.readFileSync(csvPath, 'utf-8');
                const lines = fileContent.split('\n').filter(line => line.trim() !== '');
                const csvTickerData = lines.slice(1).map(line => {
                    const parts = line.split(',');
                    return {
                        category: parts[0]?.trim(),
                        ticker: parts[1]?.trim()
                    };
                }).filter(t => t.ticker && t.ticker.length > 0 && !tickerData.some(d => d.ticker === t.ticker));
                tickerData = [...tickerData, ...csvTickerData];
            }
        } catch (e) {
            console.warn("Watchlist CSV fallback failed or file missing");
        }

        const uniqueTickers = Array.from(new Set(tickerData.map(d => d.ticker)));
        const quotes = await getLiveQuotes(uniqueTickers);

        // Fetch Real Momentum from DB
        const momentumMap: Record<string, any> = {};
        try {
            const movers = await prisma.marketMover.findMany({
                where: {
                    ticker: { in: uniqueTickers }
                }
            });

            movers.forEach(m => {
                if (!momentumMap[m.ticker]) momentumMap[m.ticker] = {};
                momentumMap[m.ticker][m.type] = m.changePercent;
            });
        } catch (e) { }

        const result = tickerData.map((data, i) => {
            const quote = quotes[data.ticker] || {
                ticker: data.ticker,
                price: 0,
                change: 0,
                changePercent: 0,
                volume: 0,
                openPrice: 0,
                prevClose: 0,
                lastUpdated: Date.now()
            };

            const momentum = momentumMap[data.ticker] || {};

            return {
                ...quote,
                category: data.category,
                momentum1min: momentum['1m_ripper'] || momentum['1m_dipper'] || 0,
                momentum5min: momentum['5m_ripper'] || momentum['5m_dipper'] || 0,
                momentum30min: momentum['30m_ripper'] || momentum['30m_dipper'] || 0,
                momentumDay: momentum['day_ripper'] || momentum['day_dipper'] || quote.changePercent || 0,
                rank: i + 1,
                openPrice: quote.openPrice || 0,
                prevClose: quote.prevClose || 0,
                lastUpdated: quote.lastUpdated || Date.now()
            };
        });

        // Update Cache
        globalThis.watchlistCache = {
            data: result,
            timestamp: now
        };

        return result;

    } catch (error) {
        console.error('Error fetching watchlist:', error);
        return [];
    }
}

export async function getCSVPortfolioHoldings(): Promise<any[]> {
    const CACHE_DURATION = 10000; // 10 seconds
    const now = Date.now();

    if (globalThis.portfolioCache && (now - globalThis.portfolioCache.timestamp < CACHE_DURATION)) {
        return globalThis.portfolioCache.data;
    }

    try {
        // Primary Source: Prisma PortfolioHolding table
        const dbHoldings = await prisma.portfolioHolding.findMany();

        if (dbHoldings.length > 0) {
            const result = dbHoldings.map(h => ({
                ticker: h.ticker,
                avgCost: h.avgCost,
                shares: h.shares
            }));

            globalThis.portfolioCache = {
                data: result,
                timestamp: now
            };
            return result;
        }

        // Fallback: CSV
        const csvPaths = [
            path.join(process.cwd(), '../portfolio.csv'),
            path.join(process.cwd(), 'public/portfolio.csv'),
            path.join(process.cwd(), 'portfolio.csv'),
            path.join(process.cwd(), '.next/server/public/portfolio.csv')
        ];

        let csvPath = null;
        for (const p of csvPaths) {
            if (fs.existsSync(p)) {
                csvPath = p;
                break;
            }
        }

        if (csvPath) {
            const fileContent = fs.readFileSync(csvPath, 'utf-8');
            const lines = fileContent.split('\n').filter(line => line.trim() !== '');
            const holdings = lines.slice(1).map(line => {
                const parts = line.split(',');
                if (parts.length < 3) return null;
                return {
                    ticker: parts[0]?.trim(),
                    avgCost: parseFloat(parts[1]?.trim().replace('$', '').replace(',', '')) || 0,
                    shares: parseFloat(parts[2]?.trim().replace(',', '')) || 0
                };
            }).filter(h => h && h.ticker);

            globalThis.portfolioCache = {
                data: holdings,
                timestamp: now
            };
            return holdings;
        }

        return [];
    } catch (error) {
        console.error('Error fetching portfolio holdings:', error);
        return [];
    }
}

export async function getTopOptions(): Promise<any[]> {
    const POLYGON_API_KEY = process.env.POLYGON_API_KEY;
    if (!POLYGON_API_KEY) return [];

    const tickers = ['SPY', 'QQQ', 'NVDA', 'TSLA', 'AAPL', 'AMD'];
    const results: any[] = [];

    try {
        const quotes = await getLiveQuotes(tickers);

        for (const ticker of tickers) {
            const quote = quotes[ticker];
            if (!quote || !quote.price) continue;

            const sentiment = quote.changePercent > 1 ? 'Call' : (quote.changePercent < -1 ? 'Put' : 'Iron Condor');
            const targetStrike = sentiment === 'Call' ? Math.ceil(quote.price * 1.05) : Math.floor(quote.price * 0.95);

            results.push({
                ticker,
                strategy: sentiment,
                strike: `$${targetStrike}`,
                exp: 'Next Fri',
                iv: `${(20 + Math.abs(quote.changePercent) * 5).toFixed(1)}%`
            });
        }
    } catch (e) { console.error(e); }

    return results;
}

export async function getMarketNews(limit: number = 10): Promise<any[]> {
    // Read from DB news table
    try {
        const rows = await prisma.news.findMany({
            orderBy: { ts: 'desc' },
            take: limit
        });

        return rows.map(r => ({
            ...r,
            time: r.ts,
            image: r.imageUrl,
            sentiment: 'neutral'
        }));
    } catch (e) {
        // Fallback to Polygon if DB is empty or fails
        console.error(e);
        return [];
    }
}

