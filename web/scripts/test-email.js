// Quick email test script
// Run: node scripts/test-email.js
require('dotenv').config({ path: '.env.local' });
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

async function main() {
    console.log('EMAIL_USER:', process.env.EMAIL_USER);
    console.log('EMAIL_PASS length:', process.env.EMAIL_PASS?.length);

    try {
        const info = await transporter.sendMail({
            from: `"StockTrack System" <${process.env.EMAIL_USER}>`,
            to: 'jaswanthvellanki11@gmail.com',
            subject: '✅ StockTrack Email Test',
            html: '<h2>Email system is working!</h2><p>This is a test from the StockTrack admin approval system.</p>',
        });
        console.log('✅ Email sent successfully! Message ID:', info.messageId);
    } catch (err) {
        console.error('❌ Email failed:', err.message);
        if (err.message.includes('535')) {
            console.log('\nFIX: Your Gmail app password might be wrong. Generate a new one at:');
            console.log('https://myaccount.google.com/apppasswords');
        }
        if (err.message.includes('534') || err.message.includes('Less secure')) {
            console.log('\nFIX: Enable 2FA and use an App Password instead of your regular password.');
        }
    }
}

main();
