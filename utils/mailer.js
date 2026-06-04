const nodemailer = require('nodemailer');

// ── Transport ─────────────────────────────────────────────────────
// Uses Gmail with an App Password (not your real Gmail password)
// Setup: Google account → Security → 2-Step Verification → App Passwords
// Generate one for "Mail" and put it in .env as GMAIL_APP_PASSWORD
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,        // noreply.conleche@gmail.com
    pass: process.env.GMAIL_APP_PASSWORD, // 16-char App Password from Google
  },
});

// ── Send order notification to all checked-in staff ───────────────
async function notifyStaffNewOrder(order, staffEmails) {
  if (!staffEmails || !staffEmails.length) return;

  const itemRows = order.items.map(item => {
    const opts = [item.size, item.flavour, item.milk !== 'Full cream' ? item.milk : null, item.sugar !== 'Regular' ? item.sugar : null]
      .filter(Boolean).join(' · ');
    return `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #f0e8df;">
          <strong style="color:#2c2c2c;">${item.name}</strong>
          ${opts ? `<br/><span style="font-size:12px;color:#888;">${opts}</span>` : ''}
          ${item.notes ? `<br/><em style="font-size:11px;color:#aaa;">"${item.notes}"</em>` : ''}
        </td>
        <td style="padding:8px 12px;border-bottom:1px solid #f0e8df;text-align:right;font-weight:600;color:#581217;">R${item.price}</td>
      </tr>`;
  }).join('');

  const placedTime = new Date(order.placedAt).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f5ede4;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5ede4;padding:32px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:#581217;padding:24px 32px;text-align:center;">
            <p style="margin:0;font-size:22px;font-weight:700;color:#fdf6ed;letter-spacing:0.03em;">☕ Con Leche</p>
            <p style="margin:6px 0 0;font-size:13px;color:rgba(253,246,237,0.65);">New order notification</p>
          </td>
        </tr>

        <!-- Order ref + time -->
        <tr>
          <td style="padding:24px 32px 0;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <p style="margin:0;font-size:11px;text-transform:uppercase;letter-spacing:0.12em;color:#aaa;">Order reference</p>
                  <p style="margin:4px 0 0;font-size:20px;font-weight:700;color:#581217;">${order.ref}</p>
                </td>
                <td align="right">
                  <p style="margin:0;font-size:11px;text-transform:uppercase;letter-spacing:0.12em;color:#aaa;">Placed at</p>
                  <p style="margin:4px 0 0;font-size:18px;font-weight:600;color:#2c2c2c;">${placedTime}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Customer -->
        <tr>
          <td style="padding:16px 32px 0;">
            <table width="100%" cellpadding="0" cellspacing="0" style="background:#fdf6ed;border-radius:10px;padding:14px 16px;">
              <tr>
                <td>
                  <p style="margin:0;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#aaa;">Customer</p>
                  <p style="margin:4px 0 0;font-size:15px;font-weight:600;color:#2c2c2c;">${order.userName || order.name}</p>
                  ${order.userEmail ? `<p style="margin:2px 0 0;font-size:12px;color:#888;">${order.userEmail}</p>` : ''}
                </td>
                <td align="right">
                  <p style="margin:0;font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:#aaa;">Collection</p>
                  <p style="margin:4px 0 0;font-size:13px;font-weight:600;color:#2c2c2c;">${order.pickupMethod || '—'}</p>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Items -->
        <tr>
          <td style="padding:20px 32px 0;">
            <p style="margin:0 0 10px;font-size:11px;text-transform:uppercase;letter-spacing:0.12em;color:#aaa;">Items</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #f0e8df;border-radius:10px;overflow:hidden;">
              ${itemRows}
              <tr>
                <td style="padding:12px 12px;font-weight:700;font-size:15px;color:#2c2c2c;">Total</td>
                <td style="padding:12px 12px;text-align:right;font-weight:700;font-size:17px;color:#581217;">R${order.total}</td>
              </tr>
            </table>
          </td>
        </tr>

        ${order.notes ? `
        <tr>
          <td style="padding:16px 32px 0;">
            <p style="margin:0;font-size:12px;color:#888;font-style:italic;background:#fdf6ed;padding:10px 14px;border-radius:8px;">📝 "${order.notes}"</p>
          </td>
        </tr>` : ''}

        <!-- Footer -->
        <tr>
          <td style="padding:24px 32px;text-align:center;border-top:1px solid #f0e8df;margin-top:20px;">
            <p style="margin:0;font-size:11px;color:#bbb;">Con Leche · This is an automated notification · Do not reply</p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  await transporter.sendMail({
    from:    `"Con Leche" <${process.env.GMAIL_USER}>`,
    to:      staffEmails.join(', '),
    subject: `☕ New order ${order.ref} — R${order.total} — ${new Date(order.placedAt).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}`,
    html,
  });
}

// ── Send order status update to the customer ──────────────────────
async function notifyCustomerStatusUpdate(order, customerEmail, newStatus) {
  if (!customerEmail) return;

  const STATUS_MSG = {
    preparing: { emoji: '☕', headline: 'We\'re making your order!', sub: 'Your barista has started on your order. Won\'t be long.' },
    ready:     { emoji: '🐾', headline: 'Your order is ready!',      sub: 'Come collect it from the truck. Show your order slip to the barista.' },
    done:      { emoji: '✓',  headline: 'Order collected',           sub: 'Thanks for visiting Con Leche. See you next time!' },
  };
  const msg = STATUS_MSG[newStatus];
  if (!msg) return; // don't email for pending

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#f5ede4;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5ede4;padding:32px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:#581217;padding:24px 32px;text-align:center;">
            <p style="margin:0;font-size:22px;font-weight:700;color:#fdf6ed;">☕ Con Leche</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px 32px;text-align:center;">
            <p style="margin:0;font-size:48px;">${msg.emoji}</p>
            <h1 style="margin:16px 0 8px;font-size:22px;color:#2c2c2c;">${msg.headline}</h1>
            <p style="margin:0;font-size:14px;color:#888;">${msg.sub}</p>
            <p style="margin:20px 0 0;font-size:13px;font-weight:600;color:#581217;">${order.ref}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:0 32px 32px;text-align:center;">
            <a href="${process.env.BASE_URL}/order/my-orders"
               style="display:inline-block;background:#581217;color:#fdf6ed;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;">
              View my orders →
            </a>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 32px;text-align:center;border-top:1px solid #f0e8df;">
            <p style="margin:0;font-size:11px;color:#bbb;">Con Leche · Do not reply to this email</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  await transporter.sendMail({
    from:    `"Con Leche" <${process.env.GMAIL_USER}>`,
    to:      customerEmail,
    subject: `${msg.emoji} ${msg.headline} — ${order.ref}`,
    html,
  });
}

module.exports = { notifyStaffNewOrder, notifyCustomerStatusUpdate };
