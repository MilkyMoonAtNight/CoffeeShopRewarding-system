const express  = require('express');
const router   = express.Router();
const User     = require('../models/User');
const QRCode   = require('qrcode');
const crypto   = require('crypto');
const { sendOtpEmail } = require('../utils/mailer');
const { sendWhatsAppMessage, normalisePhone } = require('../utils/whatsapp');
const { sendOtpWhatsAppFirst } = require('../utils/sendOtp');
const { rateLimit, asString } = require('../utils/security');

// Throttle credential / reset endpoints to blunt brute-force and reset-spam.
const loginLimiter  = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: 'Too many attempts. Please wait a few minutes and try again.' });
const resetLimiter  = rateLimit({ windowMs: 60 * 60 * 1000, max: 5,  message: 'Too many requests. Please try again later.' });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── REGISTER ──────────────────────────────────────────────────────
router.get('/register', (req, res) => {
  res.render('pages/register', { title: 'Join the Pack — Con Leche', error: null });
});

router.post('/register', loginLimiter, async (req, res) => {
  const RENDER = (error) => res.render('pages/register', { title: 'Join the Pack — Con Leche', error });
  try {
    const name     = asString(req.body.name, 100).trim();
    const email    = asString(req.body.email, 200).toLowerCase().trim();
    const phone    = asString(req.body.phone, 30).trim();
    const password = asString(req.body.password, 200);
    const confirmPassword = asString(req.body.confirmPassword, 200);
    const bdYear  = parseInt(asString(req.body.birthdayYear,  6)) || null;
    const bdMonth = parseInt(asString(req.body.birthdayMonth, 4)) || null;
    const bdDay   = parseInt(asString(req.body.birthdayDay,   4)) || null;

    if (!name || !email || !password) return RENDER('Name, email and password are required.');
    if (!/^[A-Za-z\s]+$/.test(name))  return RENDER('Name may only contain letters and spaces.');
    if (!EMAIL_RE.test(email))         return RENDER('Please enter a valid email address.');
    if (password.length < 8)           return RENDER('Password must be at least 8 characters.');
    if (password !== confirmPassword)  return RENDER('Passwords do not match.');

    const exists = await User.findOne({ email });
    if (exists) return RENDER('That email is already registered. Sign in instead?');

    const titledName = name.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');

    let birthday = null;
    if (bdMonth && bdDay) {
      const year = (bdYear && bdYear >= 1920 && bdYear <= new Date().getFullYear()) ? bdYear : 1900;
      const d = new Date(year, bdMonth - 1, bdDay);
      if (!isNaN(d.getTime())) birthday = d;
    } else if (bdYear && bdYear >= 1920 && bdYear <= new Date().getFullYear()) {
      birthday = new Date(bdYear, 0, 1);
    }

    const marketingConsent  = req.body.marketingConsent === 'on';
    const marketingChannel  = marketingConsent ? asString(req.body.marketingChannel, 20) : null;
    const normChannel       = (marketingChannel === 'whatsapp') ? 'whatsapp' : 'email';

    const normPhone = phone ? normalisePhone(phone) : null;

    const emailPreferences = {
      specials:          marketingConsent && normChannel === 'email',
      events:            req.body.notifyEvents   === 'on',
      birthday:          req.body.notifyBirthday === 'on',
      marketingWhatsapp: marketingConsent && normChannel === 'whatsapp',
    };

    const otp     = String(Math.floor(100000 + Math.random() * 900000));
    const qrToken = crypto.randomBytes(16).toString('hex');

    const user = new User({
      name:          titledName,
      email,
      password,
      phone:         phone || null,
      whatsappPhone: normPhone,
      qrCode:        qrToken,
      birthday,
      emailPreferences,
      marketingConsent,
      marketingChannel:   marketingConsent ? normChannel : null,
      marketingConsentAt: marketingConsent ? new Date() : null,
      verified: false,
      otp: {
        code:      otp,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        attempts:  0,
      },
    });
    await user.save();

    // Fire-and-forget: OTP send (updates otp.channel + otp.messageId on user)
    sendOtpWhatsAppFirst(user, otp, 'register').catch(err =>
      console.error('OTP dispatch error:', err.message)
    );

    req.session.pendingVerifyUserId = String(user._id);
    res.redirect('/verify');
  } catch (err) {
    console.error(err);
    RENDER('Something went wrong. Please try again.');
  }
});

// ── VERIFY ACCOUNT ────────────────────────────────────────────────
router.get('/verify', async (req, res) => {
  if (!req.session.pendingVerifyUserId) return res.redirect('/login');
  const user = await User.findById(req.session.pendingVerifyUserId)
    .select('otp name verified').lean().catch(() => null);
  if (!user) { req.session.pendingVerifyUserId = null; return res.redirect('/register'); }
  if (user.verified) { req.session.userId = req.session.pendingVerifyUserId; req.session.pendingVerifyUserId = null; return res.redirect('/battlepass'); }
  res.render('pages/verify', {
    title:   'Verify your account — Con Leche',
    error:   null,
    channel: (user.otp && user.otp.channel) || 'email',
    name:    user.name,
  });
});

// Channel-status poll (called every 3s from the verify page)
router.get('/verify/status', async (req, res) => {
  if (!req.session.pendingVerifyUserId) return res.json({ ok: false });
  const user = await User.findById(req.session.pendingVerifyUserId)
    .select('otp verified').lean().catch(() => null);
  if (!user) return res.json({ ok: false });
  const locked = !!(user.otp && user.otp.lockedUntil && new Date() < new Date(user.otp.lockedUntil));
  res.json({
    ok:      true,
    channel: (user.otp && user.otp.channel) || 'email',
    locked,
  });
});

router.post('/verify', loginLimiter, async (req, res) => {
  if (!req.session.pendingVerifyUserId) return res.redirect('/login');
  const RENDER = (error, channel) =>
    res.render('pages/verify', { title: 'Verify — Con Leche', error, channel: channel || 'email', name: '' });

  try {
    const user    = await User.findById(req.session.pendingVerifyUserId);
    if (!user) return res.redirect('/login');
    const entered = asString(req.body.code, 10).replace(/\s/g, '');
    const channel = (user.otp && user.otp.channel) || 'email';

    if (user.otp && user.otp.lockedUntil && new Date() < user.otp.lockedUntil) {
      return RENDER('Too many incorrect attempts. Please wait 15 minutes or request a new code.', channel);
    }
    if (!user.otp || !user.otp.code || new Date() > user.otp.expiresAt) {
      return RENDER('Your code has expired. Please request a new one below.', channel);
    }
    if (entered !== user.otp.code) {
      user.otp.attempts = (user.otp.attempts || 0) + 1;
      if (user.otp.attempts >= 5) user.otp.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
      await user.save();
      const left = Math.max(0, 5 - user.otp.attempts);
      return RENDER(
        left > 0 ? `Incorrect code — ${left} attempt${left === 1 ? '' : 's'} remaining.`
                 : 'Account locked for 15 minutes. Use "Resend code" to get a fresh one.',
        channel
      );
    }

    // ✓ Correct — activate account and log in
    user.verified      = true;
    user.otp.code      = null;
    user.otp.expiresAt = null;
    user.otp.channel   = null;
    user.otp.messageId = null;
    user.otp.attempts  = 0;
    user.otp.lockedUntil = null;
    await user.save();

    req.session.userId              = String(user._id);
    req.session.userName            = user.name;
    req.session.pendingVerifyUserId = null;
    res.redirect('/battlepass');
  } catch (err) {
    console.error(err);
    RENDER('Something went wrong. Please try again.', 'email');
  }
});

// Resend OTP (on verify page)
router.post('/verify/resend', loginLimiter, async (req, res) => {
  if (!req.session.pendingVerifyUserId) return res.json({ ok: false, message: 'Session expired.' });
  try {
    const user = await User.findById(req.session.pendingVerifyUserId);
    if (!user) return res.json({ ok: false, message: 'User not found.' });

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    user.otp.code        = otp;
    user.otp.expiresAt   = new Date(Date.now() + 10 * 60 * 1000);
    user.otp.attempts    = 0;
    user.otp.lockedUntil = null;
    user.otp.channel     = null;
    user.otp.messageId   = null;
    await user.save();

    sendOtpWhatsAppFirst(user, otp, 'register').catch(err =>
      console.error('Resend OTP error:', err.message)
    );

    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false, message: err.message });
  }
});

// ── LOGIN ─────────────────────────────────────────────────────────
router.get('/login', (req, res) => {
  res.render('pages/login', { title: 'Sign In — Con Leche', error: null, success: null, lockedUntil: null });
});

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const email    = asString(req.body.email, 200).toLowerCase();
    const password = asString(req.body.password, 200);
    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password)))
      return res.render('pages/login', { title: 'Sign In', error: 'Invalid email or password', success: null, lockedUntil: null });

    // Redirect unverified accounts back to the verify flow
    if (!user.verified) {
      const otp = String(Math.floor(100000 + Math.random() * 900000));
      user.otp = { code: otp, expiresAt: new Date(Date.now() + 10 * 60 * 1000), attempts: 0 };
      await user.save();
      sendOtpWhatsAppFirst(user, otp, 'register').catch(() => {});
      req.session.pendingVerifyUserId = String(user._id);
      return res.redirect('/verify');
    }

    // Refuse a fresh code while the account is locked out from prior failed attempts
    if (user.loginOtp && user.loginOtp.lockedUntil && new Date() < user.loginOtp.lockedUntil) {
      return res.render('pages/login', {
        title: 'Sign In', success: null,
        error: 'Too many incorrect codes.',
        lockedUntil: user.loginOtp.lockedUntil.toISOString()
      });
    }

    // Generate 6-digit OTP and store on the user (survives session/server restarts)
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    user.loginOtp = { code: otp, expiresAt: new Date(Date.now() + 10 * 60 * 1000), attempts: 0, lockedUntil: null };
    await user.save();

    req.session.pendingUserId   = String(user._id);
    req.session.pendingUserName = user.name;

    // Send OTP — WhatsApp first if configured, else email
    let sentViaWa = false;
    if (user.whatsappPhone) {
      try {
        await sendWhatsAppMessage(user.whatsappPhone, `🔐 Your Con Leche login code is *${otp}*. It expires in 10 minutes.`);
        sentViaWa = true;
      } catch {}
    }
    if (!sentViaWa) await sendOtpEmail(user.email, otp, 'login');

    res.redirect('/verify-login');
  } catch (err) {
    console.error(err);
    res.render('pages/login', { title: 'Sign In', error: 'Something went wrong.', success: null, lockedUntil: null });
  }
});

// ── VERIFY LOGIN (2FA) ────────────────────────────────────────────
router.get('/verify-login', async (req, res) => {
  if (!req.session.pendingUserId) return res.redirect('/login');
  const user = await User.findById(req.session.pendingUserId);
  if (!user) { req.session.pendingUserId = null; return res.redirect('/login'); }
  const lockedUntil = (user.loginOtp && user.loginOtp.lockedUntil && new Date() < user.loginOtp.lockedUntil)
    ? user.loginOtp.lockedUntil.toISOString() : null;
  res.render('pages/verify-login', {
    title: 'Verify — Con Leche',
    error: lockedUntil ? 'Too many incorrect attempts.' : null,
    lockedUntil
  });
});

router.post('/verify-login', loginLimiter, async (req, res) => {
  if (!req.session.pendingUserId) return res.redirect('/login');
  const RENDER = (error, lockedUntil) =>
    res.render('pages/verify-login', { title: 'Verify — Con Leche', error, lockedUntil: lockedUntil || null });

  try {
    const user = await User.findById(req.session.pendingUserId);
    if (!user) { req.session.pendingUserId = null; return res.redirect('/login'); }

    if (user.loginOtp && user.loginOtp.lockedUntil && new Date() < user.loginOtp.lockedUntil) {
      return RENDER('Too many incorrect attempts.', user.loginOtp.lockedUntil.toISOString());
    }
    if (!user.loginOtp || !user.loginOtp.code || new Date() > user.loginOtp.expiresAt) {
      return RENDER('Code expired. Please sign in again.');
    }

    const entered = asString(req.body.code, 10).replace(/\s/g, '');
    if (entered !== user.loginOtp.code) {
      user.loginOtp.attempts = (user.loginOtp.attempts || 0) + 1;
      if (user.loginOtp.attempts >= 3) {
        user.loginOtp.lockedUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
        user.loginOtp.code = null;
      }
      await user.save();
      const left = Math.max(0, 3 - user.loginOtp.attempts);
      return RENDER(
        left > 0 ? `Incorrect code — ${left} attempt${left === 1 ? '' : 's'} remaining.`
                 : 'Too many incorrect attempts.',
        user.loginOtp.lockedUntil ? user.loginOtp.lockedUntil.toISOString() : null
      );
    }

    // OTP correct — complete login
    user.loginOtp = { code: null, expiresAt: null, attempts: 0, lockedUntil: null };
    await user.save();

    req.session.userId   = req.session.pendingUserId;
    req.session.userName = req.session.pendingUserName;
    req.session.pendingUserId   = null;
    req.session.pendingUserName = null;
    res.redirect('/battlepass');
  } catch (err) {
    console.error(err);
    RENDER('Something went wrong. Please try again.');
  }
});

// ── LOGOUT ────────────────────────────────────────────────────────
router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// ── FORGOT PASSWORD (OTP flow: email → code → new password) ───────
async function sendResetOtp(user, otp) {
  let sentWa = false;
  if (user.whatsappPhone) {
    try {
      await sendWhatsAppMessage(user.whatsappPhone, `🔑 Your Con Leche password reset code is *${otp}*. It expires in 10 minutes.`);
      sentWa = true;
    } catch {}
  }
  if (!sentWa) await sendOtpEmail(user.email, otp, 'password_reset');
}

router.get('/forgot-password', (req, res) => {
  res.render('pages/forgot-password', { title: 'Forgot Password — Con Leche' });
});

router.post('/forgot-password/request', resetLimiter, async (req, res) => {
  try {
    const email = asString(req.body.email, 200).toLowerCase();
    const user  = await User.findOne({ email });

    // Always respond ok — don't reveal whether the email is registered
    if (!user) return res.json({ ok: true });

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    user.resetOtp = { code: otp, expiresAt: new Date(Date.now() + 10 * 60 * 1000), attempts: 0, lockedUntil: null };
    await user.save();
    req.session.pwResetUserId   = String(user._id);
    req.session.pwResetVerified = false;

    sendResetOtp(user, otp).catch(err => console.error('Reset OTP send error:', err.message));
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.json({ ok: false, message: 'Something went wrong. Please try again.' });
  }
});

router.post('/forgot-password/resend', resetLimiter, async (req, res) => {
  if (!req.session.pwResetUserId) return res.json({ ok: false, message: 'Session expired.' });
  try {
    const user = await User.findById(req.session.pwResetUserId);
    if (!user) return res.json({ ok: false, message: 'Session expired.' });

    const otp = String(Math.floor(100000 + Math.random() * 900000));
    user.resetOtp = { code: otp, expiresAt: new Date(Date.now() + 10 * 60 * 1000), attempts: 0, lockedUntil: null };
    await user.save();

    sendResetOtp(user, otp).catch(err => console.error('Reset OTP resend error:', err.message));
    res.json({ ok: true });
  } catch (err) {
    res.json({ ok: false, message: err.message });
  }
});

router.post('/forgot-password/verify', resetLimiter, async (req, res) => {
  if (!req.session.pwResetUserId) return res.json({ ok: false, message: 'Session expired. Please start again.' });
  try {
    const user = await User.findById(req.session.pwResetUserId);
    if (!user) return res.json({ ok: false, message: 'Session expired. Please start again.' });

    const entered = asString(req.body.code, 10).replace(/\s/g, '');
    const otp = user.resetOtp || {};

    if (otp.lockedUntil && new Date() < otp.lockedUntil) {
      return res.json({ ok: false, message: 'Too many incorrect attempts. Please wait 15 minutes or request a new code.' });
    }
    if (!otp.code || new Date() > otp.expiresAt) {
      return res.json({ ok: false, message: 'Your code has expired. Please request a new one.' });
    }
    if (entered !== otp.code) {
      user.resetOtp.attempts = (user.resetOtp.attempts || 0) + 1;
      if (user.resetOtp.attempts >= 5) user.resetOtp.lockedUntil = new Date(Date.now() + 15 * 60 * 1000);
      await user.save();
      const left = Math.max(0, 5 - user.resetOtp.attempts);
      return res.json({
        ok: false,
        message: left > 0 ? `Incorrect code — ${left} attempt${left === 1 ? '' : 's'} remaining.`
                           : 'Account locked for 15 minutes. Use "Resend code" to get a fresh one.',
      });
    }

    req.session.pwResetVerified = true;
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.json({ ok: false, message: 'Something went wrong. Please try again.' });
  }
});

router.post('/forgot-password/reset', resetLimiter, async (req, res) => {
  if (!req.session.pwResetUserId || !req.session.pwResetVerified) {
    return res.json({ ok: false, message: 'Please verify your code first.' });
  }
  try {
    const user = await User.findById(req.session.pwResetUserId);
    if (!user) return res.json({ ok: false, message: 'Session expired. Please start again.' });

    const password        = asString(req.body.password, 200);
    const confirmPassword = asString(req.body.confirmPassword, 200);
    if (password.length < 8) return res.json({ ok: false, message: 'Password must be at least 8 characters.' });
    if (password !== confirmPassword) return res.json({ ok: false, message: 'Passwords do not match.' });

    user.password = password; // pre-save hook hashes it
    user.resetOtp = { code: null, expiresAt: null, attempts: 0, lockedUntil: null };
    await user.save();

    req.session.pwResetUserId   = null;
    req.session.pwResetVerified = false;
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.json({ ok: false, message: 'Something went wrong. Please try again.' });
  }
});

// ── Delete own account ────────────────────────────────────────────
router.post('/account/delete', async (req, res) => {
  if (!req.session.userId) return res.json({ ok: false, error: 'Not logged in' });
  try {
    await User.findByIdAndDelete(req.session.userId);
    req.session.destroy(() => {
      res.json({ ok: true });
    });
  } catch (err) {
    res.json({ ok: false, error: err.message });
  }
});

module.exports = router;
