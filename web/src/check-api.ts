async function checkApi() {
    try {
        const res = await fetch('http://localhost:3000/api/movers');
        const text = await res.text();
        console.log('API Response Start:', text.substring(0, 500));
        try {
            const data = JSON.parse(text);
            console.log('Categories:', data.categories?.slice(0, 3));
        } catch (e) {
            console.error('Failed to parse JSON');
        }
    } catch (e) {
        console.error('API Check Failed:', e);
    }
}
checkApi();
