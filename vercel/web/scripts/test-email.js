require('dotenv').config({ path: './.env' });
const nodemailer = require('nodemailer');

console.log('EMAIL_USER:', process.env.EMAIL_USER);
console.log('EMAIL_PASS:', process.env.EMAIL_PASS ? '***set***' : 'NOT SET');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});

async function test() {
    try {
        // First verify connection
        console.log('\nVerifying Gmail connection...');
        await transporter.verify();
        console.log('✅ Gmail connection OK!');

        // Send test email
        console.log('\nSending test email...');
        const info = await transporter.sendMail({
            from: `"StockTrack Test" <${process.env.EMAIL_USER}>`,
            to: 'jaswanthvellanki11@gmail.com',
            subject: '✅ StockTrack Email Test',
            html: '<h2>Email is working!</h2><p>This is a test from StockTrack admin approval system.</p>',
        });

        console.log('✅ Email sent! Message ID:', info.messageId);
    } catch (err) {
        console.error('\n❌ ERROR DETAILS:');
        console.error('Code:', err.code);
        console.error('Message:', err.message);
        if (err.response) console.error('Server Response:', err.response);
    }
}

test();
