const fetch = require('node-fetch');

async function fetchYahooV8(ticker) {
    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=1d`;
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0',
                'Accept': 'application/json'
            }
        });
        const data = await res.json();
        const meta = data?.chart?.result?.[0]?.meta;
        if (!meta) return { price: 0, open: 0, prevClose: 0, changePercent: 0 };
        const price = meta.regularMarketPrice || 0;
        const prevClose = meta.chartPreviousClose || meta.previousClose || 0;
        const open = meta.regularMarketOpen || prevClose;
        const changePercent = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;
        return { price, open, prevClose, changePercent };
    } catch(e) {
        return { price: 0, error: e.message };
    }
}

async function run() {
    const tickers = ['NVTA','AYX','CLVR','SPLK','INFI','FSR','ABML','IDEX','GOEV','FUV','LTHM','AFTY','DM','ASHX','CHIE','CHII','CHIM','CHIX','CNHX','CSEX','FNI','HAHA','PEK','XINA','YAO','CHAD'];
    for (const t of tickers) {
        const d = await fetchYahooV8(t);
        console.log(`${t}: $${d.price} open=$${d.open} prevClose=$${d.prevClose} chg=${d.changePercent?.toFixed(2)}%`);
        await new Promise(r => setTimeout(r, 200));
    }
}
run();
