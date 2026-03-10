import { PrismaClient } from '@prisma/client';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const prisma = new PrismaClient();
const API_KEY = process.env.POLYGON_API_KEY || process.env.API_KEY;
const BASE_URL = 'https://api.polygon.io';

async function fetchWithTimeout(url: string, timeoutMs: number = 15000) {
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

async function getHistoricalData(ticker: string, days: number = 70) {
    const to = new Date().toISOString().split('T')[0];
    const from = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const url = `${BASE_URL}/v2/aggs/ticker/${ticker}/range/1/day/${from}/${to}?adjusted=true&sort=asc&limit=120&apiKey=${API_KEY}`;

    try {
        const res = await fetchWithTimeout(url);
        if (!res.ok) return null;
        const data = await res.json();
        return data.results || [];
    } catch (e) {
        console.error(`Failed to fetch ${ticker}:`, e);
        return null;
    }
}

function calculateBeta(tickerReturns: number[], spyReturns: number[]) {
    if (tickerReturns.length < 10 || spyReturns.length < 10) return 1.0;

    // Align lengths
    const len = Math.min(tickerReturns.length, spyReturns.length);
    const t = tickerReturns.slice(-len);
    const s = spyReturns.slice(-len);

    const tMean = t.reduce((a, b) => a + b, 0) / len;
    const sMean = s.reduce((a, b) => a + b, 0) / len;

    let covariance = 0;
    let sVariance = 0;

    for (let i = 0; i < len; i++) {
        const tDiff = t[i] - tMean;
        const sDiff = s[i] - sMean;
        covariance += tDiff * sDiff;
        sVariance += sDiff * sDiff;
    }

    return sVariance === 0 ? 1.0 : covariance / sVariance;
}

async function main() {
    console.log('--- STARTING OVERNIGHT ANALYSIS POPULATION ---');

    if (!API_KEY) {
        console.error('ERROR: No Polygon API Key found');
        return;
    }

    // 1. Get Tickers from Watchlist
    const watchlist = await prisma.watchlist.findMany({ select: { ticker: true } });
    const tickers = Array.from(new Set(watchlist.map(w => w.ticker.toUpperCase())));

    if (tickers.length === 0) {
        console.log('Watchlist is empty. Add some stocks first.');
        return;
    }

    // 2. Fetch SPY as benchmark for Beta
    console.log('Fetching SPY baseline...');
    const spyData = await getHistoricalData('SPY', 100);
    if (!spyData || spyData.length < 50) {
        console.error('Could not fetch SPY baseline');
        return;
    }
    const spyCloses = spyData.map((d: any) => d.c);
    const spyReturns = spyCloses.slice(1).map((c: number, i: number) => (c - spyCloses[i]) / spyCloses[i]);

    console.log(`Analyzing ${tickers.length} tickers...`);

    for (const ticker of tickers) {
        try {
            process.stdout.write(`Processing ${ticker}... `);
            const data = await getHistoricalData(ticker, 100);

            if (!data || data.length < 2) {
                console.log('Skipped (no data)');
                continue;
            }

            // Calculations
            const last50 = data.slice(-50);
            const dma50 = last50.reduce((sum: number, d: any) => sum + d.c, 0) / last50.length;
            const swings = last50.map((d: any) => d.h - d.l);
            const avgSwing = swings.reduce((a: number, b: number) => a + b, 0) / swings.length;

            const tCloses = data.map((d: any) => d.c);
            const tReturns = tCloses.slice(1).map((c: number, i: number) => (c - tCloses[i]) / tCloses[i]);
            const beta = calculateBeta(tReturns, spyReturns);

            // Save to DB
            await prisma.tickerStat.upsert({
                where: { ticker },
                update: {
                    dma50,
                    swingRange: avgSwing,
                    beta,
                    updatedAt: new Date()
                },
                create: {
                    ticker,
                    dma50,
                    swingRange: avgSwing,
                    beta,
                    updatedAt: new Date()
                }
            });
            console.log('Done');
        } catch (e) {
            console.log('Failed');
        }
    }

    console.log('--- ANALYSIS COMPLETE ---');
}

main().catch(console.error).finally(() => prisma.$disconnect());
