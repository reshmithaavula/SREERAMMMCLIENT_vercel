'use client';

import React, { useMemo } from 'react';
import dynamic from 'next/dynamic';
import styles from '@/app/page.module.css';
import { useMarketData } from '@/components/MarketDataContext';

const Table = dynamic(() => import('@/components/Table'), {
    ssr: false,
    loading: () => <div className="animate-pulse bg-gray-900/10 h-64 rounded-xl w-full"></div>
});

const columns = [
    { header: 'Ticker', accessor: 'ticker', render: (val: string) => <span className="font-bold text-[var(--text-primary)]">{val || '---'}</span> },
    { header: 'Last Price', accessor: 'price', render: (val: number) => `$${(val ?? 0).toFixed(2)}` },
    {
        header: 'oChange %',
        accessor: 'oChangePercent',
        render: (val: number) => (
            <span className="font-bold tabular-nums" style={{ color: (val ?? 0) >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                {(val ?? 0).toFixed(2)}%
            </span>
        )
    },
    {
        header: 'oPrice',
        accessor: 'openPrice',
        render: (val: number, row: any) => (val ?? row?.prevClose ?? 0).toFixed(2)
    },
    {
        header: 'pChange %',
        accessor: 'pChangePercent',
        render: (val: number) => (
            <span className="font-bold tabular-nums" style={{ color: (val ?? 0) >= 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                {(val ?? 0).toFixed(2)}%
            </span>
        )
    },
    {
        header: 'Last Update',
        accessor: 'lastUpdated',
        render: (val: number) => {
            try {
                const ts = val || Date.now();
                return <span className="text-[11px] font-bold text-[var(--text-tertiary)] uppercase">{new Date(ts > 1e11 ? ts : ts * 1000).toLocaleTimeString()}</span>;
            } catch (e) { return '--:--'; }
        }
    }
];

export default function CommonListsPage() {
    const { data: marketData, isLoading } = useMarketData();

    const data = useMemo(() => {
        const movers = marketData.movers;
        // In Movers API, common is return as a key, or we fallback to filtering movers
        const commonRaw = (movers?.common && movers.common.length > 0)
            ? movers.common
            : (movers?.movers ? movers.movers.filter((m: any) => m.commonFlag === 1) : []);

        const quotes = movers?.quotes || {};

        const uniqueTickers = Array.from(new Set(commonRaw.map((m: any) => m.ticker))) as string[];

        return uniqueTickers.map(ticker => {
            const m = commonRaw.find((item: any) => item.ticker === ticker);
            const q = quotes[ticker];

            const price = q?.price || m?.price || 0;
            const prevClose = q?.prevClose || m?.prevClose || 0;
            const open = q?.openPrice || m?.openPrice || prevClose || 0;

            return {
                ticker: ticker,
                price: price,
                openPrice: open,
                prevClose: prevClose,
                oChangePercent: open > 0 ? ((price - open) / open) * 100 : 0,
                pChangePercent: prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0,
                lastUpdated: q?.lastUpdated || Date.now()
            };
        });
    }, [marketData.movers]);

    return (
        <div className={styles.dashboard}>
            <header className="mb-4">
                <h1 className={styles.title}>⚡ Common Lists</h1>
                <p className={styles.subtitle}>Stocks appearing on multiple momentum lists simultaneously.</p>
            </header>

            <section className={styles.section}>
                <Table columns={columns} data={data} loading={isLoading && data.length === 0} />
            </section>
        </div>
    );
}
