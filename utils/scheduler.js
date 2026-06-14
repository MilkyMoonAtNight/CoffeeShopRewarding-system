// Daily email scheduler — fires birthday emails and admin-scheduled notifications.
// Called once after MongoDB connects in app.js; sets up a recurring 1-hour check.

const User         = require('../models/User');
const Notification = require('../models/Notification');
const { sendBirthdayEmail, sendNotificationEmail } = require('./mailer');

async function runDailyJobs() {
  const now   = new Date();
  const today = { month: now.getMonth() + 1, day: now.getDate() };

  // ── Birthday emails ────────────────────────────────────────────
  // Find users whose birthday month+day matches today and who opted in.
  // We can't query month/day directly in Mongo without aggregation,
  // so we pull a small window and filter in JS — birthday field is sparse.
  try {
    const users = await User.find({
      birthday: { $exists: true, $ne: null },
      'emailPreferences.birthday': true
    }).select('name email birthday emailPreferences').lean();

    for (const user of users) {
      const bd = new Date(user.birthday);
      if (bd.getMonth() + 1 === today.month && bd.getDate() === today.day) {
        await sendBirthdayEmail(user).catch(err =>
          console.error(`Birthday email failed for ${user.email}:`, err.message)
        );
      }
    }
  } catch (err) {
    console.error('Scheduler: birthday pass error:', err.message);
  }

  // ── Scheduled notifications ────────────────────────────────────
  try {
    // Find active notifications whose sendAt is in the past and haven't fired yet
    const pending = await Notification.find({
      active: true,
      sendAt: { $lte: now },
      sentAt: null
    });

    for (const notif of pending) {
      // Fetch opted-in users for this category
      const filter = { [`emailPreferences.${notif.category}`]: true };
      const recipients = await User.find(filter).select('name email emailPreferences').lean();

      let sent = 0;
      for (const user of recipients) {
        await sendNotificationEmail(user, notif).catch(err =>
          console.error(`Notif email failed for ${user.email}:`, err.message)
        );
        sent++;
      }

      notif.sentAt    = now;
      notif.sentCount = sent;

      // Advance the next send date for repeating notifications
      if (notif.repeat === 'weekly') {
        notif.sendAt = new Date(notif.sendAt.getTime() + 7 * 24 * 60 * 60 * 1000);
        notif.sentAt = null; // reset so the next cycle fires
      } else if (notif.repeat === 'monthly') {
        const next = new Date(notif.sendAt);
        next.setMonth(next.getMonth() + 1);
        notif.sendAt = next;
        notif.sentAt = null;
      }

      await notif.save().catch(err =>
        console.error(`Scheduler: failed to save notif ${notif._id}:`, err.message)
      );

      console.log(`✓ Notification "${notif.title}" sent to ${sent} users`);
    }
  } catch (err) {
    console.error('Scheduler: notification pass error:', err.message);
  }
}

function startScheduler() {
  // Run immediately on startup, then every hour
  runDailyJobs().catch(err => console.error('Scheduler initial run error:', err.message));
  setInterval(() => {
    runDailyJobs().catch(err => console.error('Scheduler interval error:', err.message));
  }, 60 * 60 * 1000);
  console.log('✓ Email scheduler started (runs hourly)');
}

module.exports = { startScheduler };
