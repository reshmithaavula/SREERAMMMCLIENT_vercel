const fetch = require('node-fetch');

async function checkCNBC(ticker) {
    try {
        const res = await fetch(`https://www.cnbc.com/quotes/${ticker}`, {
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        const html = await res.text();
        const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
        if (nextDataMatch) {
            const data = JSON.parse(nextDataMatch[1]);
            const quote = data.props?.pageProps?.quoteData || data.props?.pageProps?.initialQuoteData;
            if (quote) {
                return {
                    price: parseFloat(quote.last) || 0,
                    changePercent: parseFloat(quote.change_pct) || 0,
                    provider: '__NEXT_DATA__'
                };
            }
        }
        
        const price = parseFloat(html.match(/"price"\s*:\s*"([^"]+)"/)?.[1]?.replace(/,/g, '') || "0");
        return { price, provider: 'REGEX' };
    } catch(e) {
        return { price: 0, error: e.message };
    }
}

async function run() {
    const arr = ['NVTA','AYX','CLVR','SPLK','INFI','FSR','ABML','IDEX','GOEV','FUV','LTHM','AFTY','DM','ASHX','CHIE','CHII','CHIM','CHIX','CNHX','CSEX','FNI','HAHA','PEK','XINA','YAO','CHAD'];
    for (const t of arr) {
        const data = await checkCNBC(t);
        console.log(`${t}: ${data.price} (${data.provider})`);
    }
}
run();
