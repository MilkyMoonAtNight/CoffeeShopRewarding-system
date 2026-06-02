const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

async function sendPasswordReset(toEmail, resetUrl, name) {
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8" />
      <style>
        body { font-family: 'Helvetica Neue', Arial, sans-serif; background: #f0e8da; margin: 0; padding: 2rem 1rem; }
        .card { background: #ffffff; max-width: 480px; margin: 0 auto; border-radius: 16px; overflow: hidden; box-shadow: 0 8px 32px rgba(0,0,0,0.1); }
        .header { background: #0a0a0a; padding: 2rem; text-align: center; }
        .header h1 { color: #fdf6ed; font-size: 1.6rem; margin: 0.5rem 0 0; font-weight: 700; letter-spacing: 0.02em; }
        .header p { color: rgba(253,246,237,0.4); font-size: 0.8rem; margin: 0.25rem 0 0; }
        .body { padding: 2rem; }
        .body p { color: #3d3d3d; line-height: 1.7; font-size: 0.95rem; margin: 0 0 1rem; }
        .btn { display: block; background: rgb(88,18,23); color: #fdf6ed !important; text-decoration: none; text-align: center; padding: 0.9rem 2rem; border-radius: 10px; font-weight: 600; font-size: 0.95rem; margin: 1.5rem 0; }
        .footer { background: #f5f0eb; padding: 1.25rem 2rem; text-align: center; }
        .footer p { color: rgba(44,44,44,0.4); font-size: 0.75rem; margin: 0; line-height: 1.6; }
        .expiry { background: rgba(88,18,23,0.06); border-left: 3px solid rgb(88,18,23); padding: 0.75rem 1rem; border-radius: 0 8px 8px 0; font-size: 0.82rem; color: rgb(88,18,23); margin: 1rem 0; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">
          <h1>Con Leche</h1>
          <p>Password Reset Request</p>
        </div>
        <div class="body">
          <p>Hi ${name},</p>
          <p>We received a request to reset your Con Leche battlepass password. Click the button below to set a new one.</p>
          <a href="${resetUrl}" class="btn">Reset My Password</a>
          <div class="expiry">⏳ This link expires in <strong>1 hour</strong>. After that you'll need to request a new one.</div>
          <p>If you didn't request this, you can safely ignore this email — your password won't change.</p>
        </div>
        <div class="footer">
          <p>Con Leche Coffee · 134 Braam Pretorius Street, Pretoria<br/>This is an automated email, please do not reply.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  await transporter.sendMail({
    from: `"Con Leche" <${process.env.EMAIL_USER}>`,
    to: toEmail,
    subject: 'Reset your Con Leche password',
    html
  });
}

module.exports = { sendPasswordReset };
