export const TICKER_SECTORS: Record<string, string> = {
    // AI & Technology
    'NVDA': 'AI & Tech',
    'AMD': 'AI & Tech',
    'MSFT': 'AI & Tech',
    'AAPL': 'Tech (Consumer)',
    'META': 'Social Media',
    'GOOG': 'Search & AI',
    'GOOGL': 'Search & AI',
    'PLTR': 'AI & Tech',
    'AVGO': 'Semiconductors',
    'ARM': 'Semiconductors',
    'SMCI': 'AI & Tech',
    'TSM': 'Semiconductors',
    'ADBE': 'Software',
    'CRM': 'Software (SaaS)',
    'ORCL': 'Enterprise Tech',
    'ASML': 'Semiconductors',

    // EV & Automotive
    'TSLA': 'EV & Auto',
    'RIVN': 'EV & Auto',
    'LI': 'EV & Auto',
    'NIO': 'EV & Auto',
    'XPEV': 'EV & Auto',
    'F': 'Automotive',
    'GM': 'Automotive',
    'TM': 'Automotive',

    // Crypto & Fintech
    'MSTR': 'Crypto & BTC',
    'MARA': 'Crypto & BTC',
    'RIOT': 'Crypto & BTC',
    'COIN': 'Crypto Exchange',
    'SQ': 'Fintech',
    'PYPL': 'Fintech',
    'HOOD': 'Fintech',
    'JPM': 'Banking',
    'BAC': 'Banking',
    'V': 'Payments',
    'MA': 'Payments',

    // Energy & Resources
    'XOM': 'Energy (Oil)',
    'CVX': 'Energy (Oil)',
    'OXY': 'Energy (Oil)',
    'BP': 'Energy',
    'SHEL': 'Energy',
    'SLB': 'Energy Services',
    'GOLD': 'Materials (Gold)',
    'VALE': 'Materials (Mining)',

    // Healthcare
    'LLY': 'Healthcare',
    'NVO': 'Healthcare',
    'PFE': 'Healthcare',
    'JNJ': 'Healthcare',
    'MRNA': 'Healthcare',
    'AMGN': 'Healthcare',

    // Consumer & Retail
    'AMZN': 'E-Commerce',
    'WMT': 'Retail',
    'TGT': 'Retail',
    'COST': 'Retail',
    'NKE': 'Consumer Goods',
    'SBUX': 'Consumer Goods',
    'KO': 'Consumer Goods',
    'PEP': 'Consumer Goods'
};

export function getSector(ticker: string, price: number = 0): string {
    const symbol = ticker.toUpperCase().split('.')[0]; // Handle tickers like MSTR.1
    if (TICKER_SECTORS[symbol]) return TICKER_SECTORS[symbol];

    // Fallback logic
    if (price > 0 && price < 5) return 'Penny Stocks';
    if (price >= 5 && price < 50) return 'Growth';
    return 'General';
}
