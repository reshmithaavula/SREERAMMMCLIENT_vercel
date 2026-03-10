import { WebSocketServer } from 'ws';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const wss = new WebSocketServer({ port: 3001 });

console.log('--- STARTING WEBSOCKET SERVER ON PORT 3001 ---');

wss.on('connection', (ws) => {
    console.log('[WS] Client connected');

    const sendUpdate = async () => {
        try {
            const movers = await prisma.marketMover.findMany({
                take: 100,
                orderBy: { updatedAt: 'desc' }
            });
            if (ws.readyState === 1) { // OPEN
                ws.send(JSON.stringify({
                    type: 'movers',
                    data: movers,
                    timestamp: new Date().toISOString()
                }));
            }
        } catch (e) {
            console.error('[WS] Error fetching movers:', e);
        }
    };

    // Initial data
    sendUpdate();

    // Stream updates every 10 seconds
    const interval = setInterval(sendUpdate, 10000);

    ws.on('close', () => {
        clearInterval(interval);
        console.log('[WS] Client disconnected');
    });

    ws.on('error', (err) => {
        console.error('[WS] Socket error:', err);
    });
});

process.on('SIGINT', () => {
    wss.close();
    process.exit();
});

console.log('WebSocket Server ready and listening for connections.');
