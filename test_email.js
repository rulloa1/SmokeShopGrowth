/**
 * Quick SMTP test — send a demo email to yourself.
 * Run: node test_email.js
 */
require('dotenv').config();
const nodemailer = require('nodemailer');

const demoUrl = 'https://smoke-shop-premium-demo.netlify.app?name=Eagle+Smoke+Shop&city=Houston';

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: false,
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:sans-serif;color:#fff;">
  <div style="max-width:580px;margin:0 auto;padding:40px 24px;">
    <h1 style="color:#39ff14;font-size:1.5rem;margin-bottom:8px;">
      Here's your free demo, Eagle Smoke Shop! 🚀
    </h1>
    <p style="color:#ccc;font-size:1rem;line-height:1.7;margin-bottom:24px;">
      Hey! It's Alex — we just spoke on the phone. I put together a custom demo
      website just for <strong>Eagle Smoke Shop</strong>. Click below to check it out:
    </p>
    <div style="text-align:center;margin:32px 0;">
      <a href="${demoUrl}"
         style="display:inline-block;background:linear-gradient(90deg,#00f0ff,#39ff14);
                color:#000;font-weight:700;padding:14px 36px;border-radius:999px;
                font-size:1.1rem;text-decoration:none;">
        🌐 View Your Custom Demo
      </a>
    </div>
    <p style="color:#aaa;font-size:.9rem;line-height:1.7;">
      This demo is personalized for <strong>Eagle Smoke Shop</strong> in <strong>Houston</strong>.
      If you like what you see, there's a button on the page to get started — no pressure!
    </p>
    <hr style="border:none;border-top:1px solid #222;margin:32px 0;"/>
    <p style="color:#666;font-size:.82rem;">
      Alex • SmokeShopGrowth<br/>
      Questions? Just reply to this email.
    </p>
  </div>
</body>
</html>`;

transporter.sendMail({
    from: `"Alex" <${process.env.SMTP_USER}>`,
    to: process.env.SMTP_USER,
    subject: 'Your free custom website demo for Eagle Smoke Shop 🎯',
    html,
    text: `Hey! Here's your custom demo for Eagle Smoke Shop: ${demoUrl}\n\n— Alex, SmokeShopGrowth`,
})
.then(info => {
    console.log('✅ Test email sent successfully!');
    console.log('Message ID:', info.messageId);
    console.log('Demo URL:', demoUrl);
})
.catch(err => {
    console.error('❌ Failed to send test email:', err.message);
    process.exit(1);
});
