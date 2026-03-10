'use client';

import React, { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import dynamic from 'next/dynamic';

import { useSession, signOut } from 'next-auth/react';
import { LogOut, TrendingUp, TrendingDown } from 'lucide-react';
import { useMarketData } from '@/components/MarketDataContext';
import { FALLBACK_MOVER_DATA } from '@/lib/fallback-data';
import styles from '@/app/page.module.css';
import { safeSetItem } from '@/lib/storage-utils';

const PortfolioSummary = dynamic(() => import('./PortfolioSummary').then(mod => mod.PortfolioSummary), { ssr: false });
const TweetFeed = dynamic(() => import('./TweetFeed').then(mod => mod.TweetFeed), { ssr: false });
const MoverTable = dynamic(() => import('./MoverTable').then(mod => mod.MoverTable), { ssr: false, loading: () => <div className="animate-pulse h-full w-full bg-gray-50/50" /> });
const CategoryAnalysisTable = dynamic(() => import('./CategoryAnalysisTable').then(mod => mod.CategoryAnalysisTable), { ssr: false });
const BotStatus = dynamic(() => import('./BotStatus').then(mod => mod.BotStatus), { ssr: false });

interface MoverData {
    m1: { rippers: any[]; dippers: any[] };
    m5: { rippers: any[]; dippers: any[] };
    m30: { rippers: any[]; dippers: any[] };
    day: { rippers: any[]; dippers: any[] };
    news: any[];
    quotes: any;
    watchlist: any[];
}

interface DashboardProps {
    initialGainers: any[];
    initialLosers: any[];
    initialWatchlist: any[];
    initialPortfolio?: any[];
    initialQuotes?: Record<string, any>;
}

export default function Dashboard({
    initialGainers,
    initialLosers,
    initialWatchlist,
    initialPortfolio = [],
    initialQuotes = {}
}: DashboardProps) {
    const { data: globalData, isLoading } = useMarketData();
    const { data: session } = useSession();

    // Mapping global context to local variable names used in JSX
    const moverData = globalData.movers;
    const quotes = globalData.movers?.quotes || initialQuotes || {};
    const gainers = globalData.movers?.day?.rippers || initialGainers || [];
    const losers = globalData.movers?.day?.dippers || initialLosers || [];
    const watchlist = globalData.watchlist || initialWatchlist || [];
    const news = globalData.movers?.news || [];
    const categories = globalData.movers?.categories || [];

    const portfolioHoldings = globalData.portfolio || initialPortfolio || [];
    const [mounted, setMounted] = useState(false);
    const [engineStatus, setEngineStatus] = useState<any>(globalData.movers?.engineStatus || {
        isLive: false,
        lastUpdate: null,
        statusText: 'Connecting...'
    });
    const [botStatus, setBotStatus] = useState<any>(globalData.movers?.botStats || { tweetCount: 0, isActive: false });
    const [currentTime, setCurrentTime] = useState(new Date());
    const wsRef = React.useRef<WebSocket | null>(null);

    // Optimized Performance: Show relative Top and Bottom performers
    const leaders = useMemo(() => {
        return [...categories]
            .sort((a: any, b: any) => b.averageChange - a.averageChange)
            .slice(0, 50);
    }, [categories]);

    const laggards = useMemo(() => {
        return [...categories]
            .sort((a: any, b: any) => a.averageChange - b.averageChange)
            .slice(0, 50);
    }, [categories]);

    // Real-time clock update
    useEffect(() => {
        setMounted(true);
        const timer = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);


    // Sync from Global Context
    useEffect(() => {
        if (globalData.movers?.engineStatus) {
            setEngineStatus(globalData.movers.engineStatus);
        }
        if (globalData.movers?.botStats) {
            setBotStatus(globalData.movers.botStats);
        }
    }, [globalData.movers]);

    useEffect(() => {
        if (Object.keys(quotes || {}).length > 0) {
            safeSetItem('lastMarketQuotes', quotes);
        }
    }, [quotes]);

    useEffect(() => {
        setMounted(true);
        const timer = setTimeout(() => setIsInitializing(false), 5000);
        return () => clearTimeout(timer);
    }, []);

    const displayNews = news || [];

    const [isInitializing, setIsInitializing] = useState(true);

    useEffect(() => {
        const timer = setTimeout(() => setIsInitializing(false), 25000); // 25s initialization window
        return () => clearTimeout(timer);
    }, []);

    // Determine visual status
    const isLive = engineStatus?.isLive;
    const statusText = engineStatus?.statusText || 'Connecting...';
    const statusColor = engineStatus?.statusColor === 'green' ? 'text-green-500' :
        engineStatus?.statusColor === 'orange' ? 'text-orange-500' :
            engineStatus?.statusColor === 'blue' ? 'text-blue-500' :
                engineStatus?.statusColor === 'red' ? 'text-red-500' : 'text-gray-400';

    const dotColor = engineStatus?.statusColor === 'green' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' :
        engineStatus?.statusColor === 'orange' ? 'bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.6)]' :
            engineStatus?.statusColor === 'blue' ? 'bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)]' :
                engineStatus?.statusColor === 'red' ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]' : 'bg-gray-400';


    return (
        <div className={`${styles.dashboard} animate-in fade-in duration-500`}>
            {/* Main Content Areas styled with .section and .sectionTitle */}
            <main className="flex-1 min-h-0">
                {/* News Section at Top */}
                <section className="mb-3">
                    <h2 className={styles.sectionTitle}>⚡ System News & Intelligence</h2>
                    <div className="h-[115px] bg-white border border-[var(--border-color)] rounded-xl overflow-hidden shadow-sm">
                        <TweetFeed news={displayNews} layout="horizontal" />
                    </div>
                </section>



                {/* 3-Column Grid for Movers and Categories */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">

                    {/* Market Movers and Portfolio Group */}
                    <div style={{ display: 'flex', flexDirection: 'row', gap: '12px', gridColumn: 'span 3', maxHeight: '450px' }}>
                        <section style={{ flex: '1', display: 'flex', flexDirection: 'column', minHeight: '0' }}>
                            <h2 className={styles.sectionTitle}>🚀 Top Rippers</h2>
                            <div className="flex-1 shadow-sm rounded-xl overflow-hidden border border-[var(--border-color)] bg-[var(--card-bg)]">
                                <MoverTable
                                    title="DAILY RIPPERS"
                                    movers={moverData?.day?.rippers?.slice(0, 50) || []}
                                    type="gainer"
                                />
                            </div>
                        </section>

                        <section style={{ flex: '1', display: 'flex', flexDirection: 'column', minHeight: '0' }}>
                            <h2 className={styles.sectionTitle}>📉 Top Dippers</h2>
                            <div className="flex-1 shadow-sm rounded-xl overflow-hidden border border-[var(--border-color)] bg-[var(--card-bg)]">
                                <MoverTable
                                    title="DAILY DIPPERS"
                                    movers={moverData?.day?.dippers?.slice(0, 50) || []}
                                    type="loser"
                                />
                            </div>
                        </section>

                        <section style={{ flex: '1.8', display: 'flex', flexDirection: 'column', minHeight: '0' }}>
                            <h2 className={styles.sectionTitle}>💼 Active Portfolio Summary</h2>
                            <div className="flex-1 shadow-sm rounded-xl overflow-hidden border border-[var(--border-color)] bg-[var(--card-bg)]">
                                <PortfolioSummary quotes={quotes} initialHoldings={portfolioHoldings} />
                            </div>
                        </section>
                    </div>

                    {/* Sector Grid */}
                    <div style={{ display: 'flex', flexDirection: 'row', gap: '12px', gridColumn: 'span 3', maxHeight: '400px' }}>
                        <section style={{ flex: '1', display: 'flex', flexDirection: 'column', minHeight: '0' }}>
                            <h2 className={styles.sectionTitle}>📈 Sector Leaders</h2>
                            <div className="flex-1 shadow-sm rounded-xl overflow-hidden border border-[var(--border-color)]">
                                <CategoryAnalysisTable
                                    categories={leaders}
                                    title="TOP SECTORS"
                                    icon={<TrendingUp className="w-4 h-4 text-[var(--accent-green)]" />}
                                />
                            </div>
                        </section>
                        <section style={{ flex: '1', display: 'flex', flexDirection: 'column' }}>
                            <h2 className={styles.sectionTitle}>📉 Sector Laggards</h2>
                            <div className="flex-1 shadow-sm rounded-xl overflow-hidden border border-[var(--border-color)]">
                                <CategoryAnalysisTable
                                    categories={laggards}
                                    title="BOTTOM SECTORS"
                                    icon={<TrendingDown className="w-4 h-4 text-[var(--accent-red)]" />}
                                />
                            </div>
                        </section>
                    </div>
                </div>
            </main >
            <footer className="mt-4 flex justify-between items-center text-[10px] text-[var(--text-tertiary)] font-bold tracking-widest uppercase pb-2">
                <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2.5 px-4 py-1 bg-[var(--card-bg)] border border-[var(--border-color)] rounded-full shadow-sm">
                        <div className={`w-2.5 h-2.5 rounded-full ${dotColor}`}></div>
                        <span className="text-[10px] font-bold text-[var(--text-primary)] uppercase tracking-widest leading-none mt-0.5">
                            System Status: <span className={statusColor}>{statusText}</span>
                        </span>
                    </div>
                    {mounted && engineStatus?.lastUpdate && (
                        <div className="text-[10px] text-[var(--text-tertiary)] font-bold uppercase tracking-tighter flex items-center gap-3" suppressHydrationWarning>
                            <span>
                                Last Synced: {(() => {
                                    const d = new Date(engineStatus.lastUpdate);
                                    const isToday = d.toDateString() === new Date().toDateString();
                                    return isToday ? d.toLocaleTimeString() : `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
                                })()}
                            </span>
                            <span className="opacity-30">|</span>
                            <span className="text-[var(--accent-blue)]">Local Time: {currentTime.toLocaleTimeString()}</span>
                        </div>
                    )}
                </div>


            </footer >
        </div >
    );
}
