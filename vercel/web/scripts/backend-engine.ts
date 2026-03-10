import fs from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const HEADER_DATA_PATH = path.join(process.cwd(), '../header_data.json');

// Use API_KEY or POLYGON_API_KEY
const API_KEY = process.env.POLYGON_API_KEY || process.env.API_KEY;
const BASE_URL = 'https://api.polygon.io';

async function fetchWithTimeout(url: string, timeoutMs: number = 10000) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
            },
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        return response;
    } catch (error) {
        clearTimeout(timeoutId);
        throw error;
    }
}

function extractValue(html: string, className: string): string | null {
    // Use a non-greedy match that stops at the first tag or icon
    const regex = new RegExp(`class=["'][^"']*${className}[^"']*["'][^>]*>\\s*([^<]+)`, 'i');
    const match = html.match(regex);
    if (!match) return null;

    let text = match[1].trim();

    // Some CNBC pages have price and change in the same span but separated by icons
    // We only want the first part which is the price/label
    // Remove everything starting from a '+' or '-' if it's following a number
    // e.g. "23,094.704+231.022" -> "23,094.704"
    if (className.includes('Price')) {
        const parts = text.split(/[\+\-]/);
        if (parts.length > 1) {
            text = parts[0].trim();
        }
    }

    return text || null;
}

async function scrapeCNBC(url: string, symbol: string) {
    try {
        const res = await fetchWithTimeout(url, 15000);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const html = await res.text();

        const price = extractValue(html, 'QuoteStrip-lastPrice');
        let changePct = extractValue(html, 'QuoteStrip-changeDown');
        if (!changePct) changePct = extractValue(html, 'QuoteStrip-changeUp');
        if (!changePct) changePct = extractValue(html, 'QuoteStrip-changeUnch');

        return {
            price: price || "N/A",
            change: changePct || "0.00%"
        };
    } catch (e) {
        console.error(`[Scraper] Failed to fetch ${symbol}:`, e);
        return { price: "N/A", change: "0.00%" };
    }
}

const TICKER_URLS = {
    NASDAQ: "https://www.cnbc.com/quotes/.IXIC",
    FUTURES: "https://www.cnbc.com/quotes/@ND.1",
    BTC: "https://www.cnbc.com/quotes/BTC.CM=",
    ETH: "https://www.cnbc.com/quotes/ETH.CM=",
    GLD: "https://www.cnbc.com/quotes/GLD",
    SLV: "https://www.cnbc.com/quotes/SLV"
};

async function getWatchlistTickers(): Promise<string[]> {
    const tickers = new Set<string>();

    // 1. From DB
    try {
        const dbWatchlist = await prisma.watchlist.findMany({ select: { ticker: true } });
        dbWatchlist.forEach(w => tickers.add(w.ticker.toUpperCase()));
    } catch (e) {
        console.warn('Could not fetch watchlist from DB');
    }

    // 2. From CSV
    const csvPath = path.join(process.cwd(), '../Watchlist_New.csv');
    if (fs.existsSync(csvPath)) {
        try {
            const content = fs.readFileSync(csvPath, 'utf-8');
            const lines = content.split('\n');
            for (let i = 1; i < lines.length; i++) {
                const parts = lines[i].split(',');
                if (parts.length > 1) {
                    const t = parts[1]?.trim().toUpperCase();
                    if (t) tickers.add(t);
                }
            }
        } catch (e) {
            console.warn('Could not read Watchlist_New.csv');
        }
    }

    return Array.from(tickers);
}

async function updateData() {
    console.log(`[${new Date().toLocaleTimeString()}] Fetching market data...`);

    const tickers = await getWatchlistTickers();
    if (tickers.length === 0) {
        console.warn('Watchlist is empty.');
        return;
    }

    // Batch tickers (max 50)
    const batchSize = 50;
    const allMovers: any[] = [];

    for (let i = 0; i < tickers.length; i += batchSize) {
        const batch = tickers.slice(i, i + batchSize);
        const tickerString = batch.join(',');
        const url = `${BASE_URL}/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${tickerString}&apiKey=${API_KEY}`;

        try {
            const res = await fetchWithTimeout(url);
            if (!res.ok) {
                console.error(`Polygon API error: ${res.status}`);
                continue;
            }
            const data = await res.json();
            if (data.tickers) {
                data.tickers.forEach((t: any) => {
                    const price = t.lastTrade?.p || t.min?.c || t.prevDay?.c || 0;
                    const prevClose = t.prevDay?.c || 0;
                    const changePercent = t.todaysChangePerc || 0;

                    allMovers.push({
                        ticker: t.ticker,
                        price: price,
                        changePercent: changePercent,
                        dayOpen: t.day?.o || price,
                        prevClose: prevClose,
                        type: changePercent >= 0 ? 'day_ripper' : 'day_dipper',
                        session: 'Regular',
                        updatedAt: new Date()
                    });
                });
            }
        } catch (e) {
            console.error(`Failed to fetch batch:`, e);
        }
    }

    if (allMovers.length > 0) {
        // Clear and update
        await prisma.marketMover.deleteMany({});
        const insertBatchSize = 100;
        for (let i = 0; i < allMovers.length; i += insertBatchSize) {
            const chunk = allMovers.slice(i, i + insertBatchSize);
            await prisma.marketMover.createMany({
                data: chunk
            });
        }
        console.log(`[OK] Updated ${allMovers.length} records.`);
    }

    // Update Header Data
    console.log('Fetching Header Tickers...');
    const [nas, fut, btc, eth, gld, slv] = await Promise.all([
        scrapeCNBC(TICKER_URLS.NASDAQ, 'NASDAQ'),
        scrapeCNBC(TICKER_URLS.FUTURES, 'FUTURES'),
        scrapeCNBC(TICKER_URLS.BTC, 'BTC'),
        scrapeCNBC(TICKER_URLS.ETH, 'ETH'),
        scrapeCNBC(TICKER_URLS.GLD, 'GLD'),
        scrapeCNBC(TICKER_URLS.SLV, 'SLV')
    ]);

    const headerData = {
        nasdaq: nas,
        nasdaq_futures: fut,
        btc: btc,
        eth: eth,
        gld: gld,
        slv: slv,
        last_updated: new Date().toISOString()
    };

    fs.writeFileSync(HEADER_DATA_PATH, JSON.stringify(headerData, null, 2));
    console.log(`[OK] Updated header_data.json at ${HEADER_DATA_PATH}`);
}

async function main() {
    console.log('--- STARTING BACKEND ENGINE (LOOP MODE) ---');
    if (!API_KEY) {
        console.error('ERROR: No API_KEY found');
        return;
    }

    while (true) {
        try {
            await updateData();
        } catch (e) {
            console.error('Update Cycle Error:', e);
        }
        // Wait 30 seconds
        await new Promise(resolve => setTimeout(resolve, 30000));
    }
}

main()
    .catch(e => console.error('Engine Crash:', e))
    .finally(async () => {
        await prisma.$disconnect();
    });
