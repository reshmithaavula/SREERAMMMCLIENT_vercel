import { NextResponse } from 'next/server';
import { updateMarketMovers } from '@/lib/market-service';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        console.log('[API Sync] Manual sync triggered');
        await updateMarketMovers();
        return NextResponse.json({
            success: true,
            message: 'Market data sync completed. Check /api/debug for record counts.'
        });
    } catch (error: any) {
        console.error('[API Sync] Sync failed:', error.message);
        return NextResponse.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
}
