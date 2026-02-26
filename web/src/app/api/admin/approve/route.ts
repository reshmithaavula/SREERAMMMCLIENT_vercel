import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

export async function GET(req: NextRequest) {
    const { searchParams } = new URL(req.url);
    const token = searchParams.get('token');
    const action = searchParams.get('action'); // 'accept' or 'reject'

    if (!token || !action) {
        return new NextResponse(renderPage('Invalid Link', 'The link is missing required parameters.', false), {
            status: 400, headers: { 'Content-Type': 'text/html' }
        });
    }

    const user = await prisma.user.findUnique({ where: { approvalToken: token } });

    if (!user) {
        return new NextResponse(renderPage('Link Expired', 'This approval link is invalid or has already been used.', false), {
            status: 404, headers: { 'Content-Type': 'text/html' }
        });
    }

    if (action === 'accept') {
        await prisma.user.update({
            where: { id: user.id },
            data: {
                status: 'approved',
                role: 'owner',
                approvalToken: null, // Consume the token
            },
        });
        return new NextResponse(
            renderPage(
                '✅ Access Granted',
                `<strong>${user.name}</strong> (${user.email}) has been approved as an Administrator and now has full access to StockTrack.`,
                true
            ),
            { status: 200, headers: { 'Content-Type': 'text/html' } }
        );
    } else if (action === 'reject') {
        await prisma.user.update({
            where: { id: user.id },
            data: {
                status: 'rejected',
                role: 'user',
                approvalToken: null, // Consume the token
            },
        });
        return new NextResponse(
            renderPage(
                '❌ Access Denied',
                `<strong>${user.name}</strong> (${user.email}) has been rejected and will not have admin access to StockTrack.`,
                false
            ),
            { status: 200, headers: { 'Content-Type': 'text/html' } }
        );
    }

    return new NextResponse(renderPage('Unknown Action', 'The action specified is not recognized.', false), {
        status: 400, headers: { 'Content-Type': 'text/html' }
    });
}

function renderPage(title: string, message: string, success: boolean): string {
    const color = success ? '#16a34a' : '#dc2626';
    const bg = success ? '#f0fdf4' : '#fef2f2';
    const border = success ? '#bbf7d0' : '#fecaca';

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;">
  <div style="max-width:480px;width:100%;margin:24px;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.1);">
    <div style="background:linear-gradient(135deg,#1e293b,#0f172a);padding:28px;text-align:center;">
      <span style="color:#fff;font-size:20px;font-weight:800;">📈 StockTrack</span>
      <p style="color:#94a3b8;margin:6px 0 0;font-size:11px;letter-spacing:2px;text-transform:uppercase;">Admin Portal</p>
    </div>
    <div style="padding:40px 36px;text-align:center;">
      <div style="background:${bg};border:1px solid ${border};border-radius:14px;padding:28px;margin-bottom:28px;">
        <h2 style="color:${color};font-size:22px;margin:0 0 14px;font-weight:700;">${title}</h2>
        <p style="color:#475569;font-size:14px;line-height:1.6;margin:0;">${message}</p>
      </div>
      <p style="color:#94a3b8;font-size:12px;margin:0;">You can close this tab. This action has been saved.</p>
    </div>
  </div>
</body>
</html>`;
}
