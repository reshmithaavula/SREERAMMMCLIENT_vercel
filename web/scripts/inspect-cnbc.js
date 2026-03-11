async function check() {
    const ticker = 'AAPL';
    const url = `https://www.cnbc.com/quotes/${ticker}`;
    const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const html = await res.text();
    
    const keys = ['price', 'open', 'previous_close', 'regularMarketPrice', 'regularMarketOpen', 'regularMarketPreviousClose', 'priceChangePercent'];
    keys.forEach(key => {
        const regex = new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`, 'g');
        const match = regex.exec(html);
        if (match) {
            console.log(`Key Found: ${key} = ${match[1]}`);
        } else {
            console.log(`Key Not Found: ${key}`);
        }
    });
}
check();
