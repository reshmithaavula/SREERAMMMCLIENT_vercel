import { NextResponse } from 'next/server';
import { updateMarketMovers } from '@/lib/market-service';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const force = searchParams.get('force') === 'true';
        
        console.log(`[API Sync] Manual sync triggered${force ? ' (FORCED)' : ''}`);
        const result = await updateMarketMovers(20, force); // Process 20 at a time
        return NextResponse.json(result);
    } catch (error: any) {
        console.error('[API Sync] Sync failed:', error.message);
        return NextResponse.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
}
