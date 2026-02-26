import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

interface AdminInfo {
    id: string;
    name: string;
    email: string;
    approvalToken: string;
}

export async function sendAdminApprovalEmail(admin: AdminInfo) {
    const appUrl = process.env.APP_URL || 'http://localhost:3000';
    const ownerEmail = 'jaswanthvellanki11@gmail.com';

    const acceptUrl = `${appUrl}/api/admin/approve?token=${admin.approvalToken}&action=accept`;
    const rejectUrl = `${appUrl}/api/admin/approve?token=${admin.approvalToken}&action=reject`;

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
      <div style="max-width:560px;margin:40px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        
        <!-- Header -->
        <div style="background:linear-gradient(135deg,#1e293b 0%,#0f172a 100%);padding:32px;text-align:center;">
          <div style="display:inline-flex;align-items:center;gap:10px;">
            <span style="font-size:28px;">📈</span>
            <span style="color:#fff;font-size:22px;font-weight:800;letter-spacing:-0.5px;">StockTrack</span>
          </div>
          <p style="color:#94a3b8;margin:8px 0 0;font-size:13px;letter-spacing:2px;text-transform:uppercase;">Admin Portal</p>
        </div>

        <!-- Body -->
        <div style="padding:36px 32px;">
          <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:10px;padding:14px 18px;margin-bottom:28px;display:flex;align-items:center;gap:10px;">
            <span style="font-size:20px;">🔔</span>
            <span style="color:#92400e;font-size:13px;font-weight:600;">New Administrator Access Request</span>
          </div>

          <h2 style="color:#0f172a;font-size:20px;margin:0 0 8px;font-weight:700;">Approval Required</h2>
          <p style="color:#64748b;font-size:14px;line-height:1.6;margin:0 0 24px;">
            A new user has requested admin access to the StockTrack platform. Please review their details and take action.
          </p>

          <!-- Admin Info Card -->
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:28px;">
            <table style="width:100%;border-collapse:collapse;">
              <tr>
                <td style="padding:8px 0;color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:1px;font-weight:600;width:100px;">Name</td>
                <td style="padding:8px 0;color:#0f172a;font-size:14px;font-weight:600;">${admin.name}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Email</td>
                <td style="padding:8px 0;color:#0f172a;font-size:14px;">${admin.email}</td>
              </tr>
              <tr>
                <td style="padding:8px 0;color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Time</td>
                <td style="padding:8px 0;color:#0f172a;font-size:14px;">${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST</td>
              </tr>
            </table>
          </div>

          <p style="color:#64748b;font-size:13px;margin:0 0 20px;">Click one of the buttons below to approve or reject this request:</p>

          <!-- Action Buttons -->
          <div style="display:flex;gap:12px;margin-bottom:28px;">
            <a href="${acceptUrl}" 
               style="flex:1;display:inline-block;text-align:center;padding:14px 24px;background:linear-gradient(135deg,#16a34a,#15803d);color:#fff;text-decoration:none;border-radius:10px;font-weight:700;font-size:15px;letter-spacing:0.3px;">
              ✅ Accept
            </a>
            <a href="${rejectUrl}" 
               style="flex:1;display:inline-block;text-align:center;padding:14px 24px;background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;text-decoration:none;border-radius:10px;font-weight:700;font-size:15px;letter-spacing:0.3px;">
              ❌ Reject
            </a>
          </div>

          <div style="border-top:1px solid #e2e8f0;padding-top:20px;">
            <p style="color:#94a3b8;font-size:12px;margin:0;line-height:1.5;">
              If the buttons don't work, copy and paste:<br>
              <strong>Accept:</strong> <a href="${acceptUrl}" style="color:#3b82f6;word-break:break-all;">${acceptUrl}</a><br>
              <strong>Reject:</strong> <a href="${rejectUrl}" style="color:#ef4444;word-break:break-all;">${rejectUrl}</a>
            </p>
          </div>
        </div>

        <!-- Footer -->
        <div style="background:#f8fafc;padding:20px 32px;text-align:center;border-top:1px solid #e2e8f0;">
          <p style="color:#94a3b8;font-size:11px;margin:0;">StockTrack Admin Portal • This email was sent to the owner automatically.</p>
        </div>
      </div>
    </body>
    </html>
  `;

    await transporter.sendMail({
        from: `"StockTrack System" <${process.env.EMAIL_USER}>`,
        to: ownerEmail,
        subject: `🔔 Admin Access Request: ${admin.name} (${admin.email})`,
        html,
    });

    console.log(`[MAILER] Approval email sent to ${ownerEmail} for ${admin.email}`);
}
