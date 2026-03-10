import { prisma } from './prisma';

interface TickerValue {
    price: string;
    change: string;
}

interface TickerData {
    nasdaq: TickerValue;
    nasdaq_futures: TickerValue;
    btc: TickerValue;
    eth: TickerValue;
    gld: TickerValue;
    slv: TickerValue;
    last_updated: string;
}

const TICKER_URLS = {
    NASDAQ: "https://www.cnbc.com/quotes/.IXIC",
    FUTURES: "https://www.cnbc.com/quotes/@ND.1",
    BTC: "https://www.cnbc.com/quotes/BTC.CM=",
    ETH: "https://www.cnbc.com/quotes/ETH.CM=",
    GLD: "https://www.cnbc.com/quotes/GLD",
    SLV: "https://www.cnbc.com/quotes/SLV"
};

// In-memory cache for serverless environments
let cache: { data: TickerData, timestamp: number } | null = null;
const CACHE_TTL = 30000; // 30 seconds

async function scrapeCNBC(url: string, symbol: string): Promise<TickerValue> {
    try {
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
            },
            next: { revalidate: 30 }
        });

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const html = await res.text();

        // CNBC provides a JSON blob in a script tag that contains very clean data
        // Search for "price":"XXX","priceChange":"XXX","priceChangePercent":"XXX"
        const priceMatch = html.match(/"price"\s*:\s*"([^"]+)"/);
        const changePctMatch = html.match(/"priceChangePercent"\s*:\s*"([^"]+)"/);
        const changeMatch = html.match(/"priceChange"\s*:\s*"([^"]+)"/);

        let price = priceMatch ? priceMatch[1] : "N/A";
        let changePct = changePctMatch ? changePctMatch[1] : "0.00";
        let changeRaw = changeMatch ? parseFloat(changeMatch[1]) : 0;

        // Clean up price (remove extra decimals if index)
        if (price !== "N/A" && price.includes(".") && symbol === "NASDAQ") {
            const val = parseFloat(price.replace(/,/g, ''));
            price = val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }

        // Format percentage change
        const pctVal = parseFloat(changePct);
        const sign = pctVal > 0 ? "+" : "";
        const formattedChange = `${sign}${pctVal.toFixed(2)}%`;

        return {
            price: price,
            change: formattedChange
        };
    } catch (e) {
        console.error(`[Ticker Service] Failed to fetch ${symbol}:`, e);
        return { price: "N/A", change: "0.00%" };
    }
}

export async function getLiveTickers(): Promise<TickerData> {
    if (cache && (Date.now() - cache.timestamp < CACHE_TTL)) {
        return cache.data;
    }

    try {
        const [nas, fut, btc, eth, gld, slv] = await Promise.all([
            scrapeCNBC(TICKER_URLS.NASDAQ, 'NASDAQ'),
            scrapeCNBC(TICKER_URLS.FUTURES, 'FUTURES'),
            scrapeCNBC(TICKER_URLS.BTC, 'BTC'),
            scrapeCNBC(TICKER_URLS.ETH, 'ETH'),
            scrapeCNBC(TICKER_URLS.GLD, 'GLD'),
            scrapeCNBC(TICKER_URLS.SLV, 'SLV')
        ]);

        const data: TickerData = {
            nasdaq: nas,
            nasdaq_futures: fut,
            btc: btc,
            eth: eth,
            gld: gld,
            slv: slv,
            last_updated: new Date().toISOString()
        };

        cache = { data, timestamp: Date.now() };
        return data;
    } catch (e) {
        console.error("[Ticker Service] Global fetch failure:", e);
        // Return blank but valid object to prevent crashes
        const empty = { price: "N/A", change: "0.00%" };
        return {
            nasdaq: empty,
            nasdaq_futures: empty,
            btc: empty,
            eth: empty,
            gld: empty,
            slv: empty,
            last_updated: new Date().toISOString()
        };
    }
}
