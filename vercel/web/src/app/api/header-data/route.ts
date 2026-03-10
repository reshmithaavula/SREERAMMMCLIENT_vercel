import { NextResponse } from 'next/server'
import { getLiveTickers } from '@/lib/ticker-service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
    try {
        const data = await getLiveTickers();

        return NextResponse.json(data, {
            headers: {
                'Cache-Control': 'public, s-maxage=30, stale-while-revalidate=59'
            }
        })

    } catch (error) {
        console.error('Error fetching header data:', error)

        return NextResponse.json({
            nasdaq: { price: "...", change: "0%" },
            nasdaq_futures: { price: "...", change: "0%" },
            btc: { price: "...", change: "0%" },
            eth: { price: "...", change: "0%" },
            gld: { price: "...", change: "0%" },
            slv: { price: "...", change: "0%" },
            last_updated: "Error"
        })
    }
}
