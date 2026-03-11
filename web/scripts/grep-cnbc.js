async function check() {
    const ticker = 'AAPL';
    const url = `https://www.cnbc.com/quotes/${ticker}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    const html = await res.text();
    
    // Find EVERY string that looks like "key": value
    const regex = /"([^"]+)"\s*:\s*([^,}]+)/g;
    let match;
    const results = [];
    while ((match = regex.exec(html)) !== null) {
        const key = match[1];
        const val = match[2];
        if (key.toLowerCase().includes('close') || key.toLowerCase().includes('open') || key.toLowerCase().includes('price')) {
            results.push({ key, val });
        }
    }
    console.log(JSON.stringify(results.slice(0, 100), null, 2));
}
check();
