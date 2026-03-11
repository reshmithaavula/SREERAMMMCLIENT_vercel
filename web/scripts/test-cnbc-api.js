async function check() {
    const symbols = 'AAPL,TSLA,MSFT,BTC.CM=';
    const url = `https://quote.cnbc.com/quote-html-webservice/quote.ashx?symbols=${symbols}&requestMethod=quick&noform=1&realtime=1&output=json`;
    const res = await fetch(url);
    const data = await res.json();
    console.log(JSON.stringify(data, null, 2));
}
check();
