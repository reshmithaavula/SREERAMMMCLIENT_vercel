const fetch = require('node-fetch');

async function scrapeYahoo(ticker) {
    try {
        const url = `https://finance.yahoo.com/quote/${ticker}/`;
        const res = await fetch(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml',
                'Accept-Language': 'en-US,en;q=0.9',
            }
        });
        const html = await res.text();

        // Try to find the price in the JSON blob
        const priceMatch = html.match(/"regularMarketPrice":\{"raw":([\d.]+)/);
        const changePctMatch = html.match(/"regularMarketChangePercent":\{"raw":([-\d.]+)/);
        const openMatch = html.match(/"regularMarketOpen":\{"raw":([\d.]+)/);
        const prevCloseMatch = html.match(/"regularMarketPreviousClose":\{"raw":([\d.]+)/);

        return {
            price: parseFloat(priceMatch?.[1] || '0'),
            changePercent: parseFloat(changePctMatch?.[1] || '0'),
            open: parseFloat(openMatch?.[1] || '0'),
            prevClose: parseFloat(prevCloseMatch?.[1] || '0'),
        };
    } catch (e) {
        return { price: 0, error: e.message };
    }
}

async function run() {
    const tickers = ['NVTA','AYX','CLVR','SPLK','INFI','FSR','ABML','IDEX','GOEV','FUV','LTHM','AFTY','DM','ASHX','CHIE','CHII','CHIM','CHIX','CNHX','CSEX','FNI','HAHA','PEK','XINA','YAO','CHAD'];
    for (const t of tickers) {
        const data = await scrapeYahoo(t);
        console.log(`${t}: price=$${data.price} chg=${data.changePercent?.toFixed(2)}% open=$${data.open} prevClose=$${data.prevClose}`);
    }
}
run();
