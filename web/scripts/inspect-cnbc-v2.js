async function check() {
    const ticker = 'AAPL';
    const url = `https://www.cnbc.com/quotes/${ticker}`;
    const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    const html = await res.text();
    
    // Look for __NEXT_DATA__
    const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([^<]+)<\/script>/);
    if (nextDataMatch) {
        console.log("Found __NEXT_DATA__ block");
        const json = JSON.parse(nextDataMatch[1]);
        // Search inside the JSON for keys
        const searchJson = (obj, target) => {
            let matches = [];
            const walk = (item) => {
                if (!item) return;
                if (typeof item === 'object') {
                    for (const key in item) {
                        if (key.toLowerCase().includes(target.toLowerCase())) {
                            matches.push({ key, value: item[key] });
                        }
                        walk(item[key]);
                    }
                }
            };
            walk(obj);
            return matches;
        };
        
        console.log("Looking for 'previousClose'...");
        console.log(searchJson(json, "previousClose").slice(0, 5));
        console.log("Looking for 'price'...");
        console.log(searchJson(json, "price").slice(0, 5));
        console.log("Looking for 'open'...");
        console.log(searchJson(json, "open").slice(0, 5));
    } else {
        console.log("No __NEXT_DATA__ found");
    }
}
check();
