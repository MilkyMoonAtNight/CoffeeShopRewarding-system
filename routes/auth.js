const express  = require('express');
const router   = express.Router();
const User     = require('../models/User');
const QRCode   = require('qrcode');
const crypto   = require('crypto');
const { sendPasswordReset } = require('../utils/mailer');
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
  try {
    const name     = asString(req.body.name, 100);
    const email    = asString(req.body.email, 200).toLowerCase();
    const password = asString(req.body.password, 200);
    const confirmPassword = asString(req.body.confirmPassword, 200);
    const birthdayRaw = asString(req.body.birthday, 20);

    if (!name || !email || !password)
      return res.render('pages/register', { title: 'Join the Pack', error: 'All fields are required' });
    if (!EMAIL_RE.test(email))
      return res.render('pages/register', { title: 'Join the Pack', error: 'Please enter a valid email address' });
    if (password.length < 8)
      return res.render('pages/register', { title: 'Join the Pack', error: 'Password must be at least 8 characters' });
    if (password !== confirmPassword)
      return res.render('pages/register', { title: 'Join the Pack', error: 'Passwords do not match' });
    const exists = await User.findOne({ email });
    if (exists)
      return res.render('pages/register', { title: 'Join the Pack', error: 'Email already registered' });
    // Birthday: stored only when it's a valid past date
    let birthday = null;
    if (birthdayRaw) {
      const d = new Date(birthdayRaw);
      if (!isNaN(d.getTime()) && d < new Date()) birthday = d;
    }

    const emailPreferences = {
      specials: req.body.notifySpecials !== 'false',
      events:   req.body.notifyEvents   !== 'false',
      birthday: req.body.notifyBirthday !== 'false',
    };

    const qrToken = crypto.randomBytes(16).toString('hex');
    const user = new User({ name, email, password, qrCode: qrToken, birthday, emailPreferences });
    await user.save();
    req.session.userId   = user._id;
    req.session.userName = user.name;
    res.redirect('/battlepass');
  } catch (err) {
    console.error(err);
    res.render('pages/register', { title: 'Join the Pack', error: 'Something went wrong. Try again.' });
  }
});

// ── LOGIN ─────────────────────────────────────────────────────────
router.get('/login', (req, res) => {
  res.render('pages/login', { title: 'Sign In — Con Leche', error: null, success: null });
});

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const email    = asString(req.body.email, 200).toLowerCase();
    const password = asString(req.body.password, 200);
    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password)))
      return res.render('pages/login', { title: 'Sign In', error: 'Invalid email or password', success: null });
    req.session.userId   = user._id;
    req.session.userName = user.name;
    res.redirect('/battlepass');
  } catch (err) {
    console.error(err);
    res.render('pages/login', { title: 'Sign In', error: 'Something went wrong.', success: null });
  }
});

// ── LOGOUT ────────────────────────────────────────────────────────
router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// ── FORGOT PASSWORD ───────────────────────────────────────────────
router.get('/forgot-password', (req, res) => {
  res.render('pages/forgot-password', { title: 'Forgot Password — Con Leche', error: null, success: null });
});

router.post('/forgot-password', resetLimiter, async (req, res) => {
  try {
    const email = asString(req.body.email, 200).toLowerCase();
    const user = await User.findOne({ email });

    // Always show success — don't reveal if email exists
    const successMsg = "If that email is registered you'll receive a reset link shortly.";

    if (!user) return res.render('pages/forgot-password', { title: 'Forgot Password', error: null, success: successMsg });

    const token   = crypto.randomBytes(32).toString('hex');
    user.resetToken       = token;
    user.resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour
    await user.save();

    const resetUrl = `${req.protocol}://${req.get('host')}/reset-password/${token}`;
    await sendPasswordReset(user.email, resetUrl, user.name);

    res.render('pages/forgot-password', { title: 'Forgot Password', error: null, success: successMsg });
  } catch (err) {
    console.error(err);
    res.render('pages/forgot-password', { title: 'Forgot Password', error: 'Something went wrong. Try again.', success: null });
  }
});

// ── RESET PASSWORD ────────────────────────────────────────────────
router.get('/reset-password/:token', async (req, res) => {
  const user = await User.findOne({
    resetToken: req.params.token,
    resetTokenExpiry: { $gt: new Date() }
  });
  if (!user) {
    return res.render('pages/reset-password', {
      title: 'Reset Password — Con Leche',
      error: 'This reset link has expired or is invalid. Please request a new one.',
      success: null, token: null, valid: false
    });
  }
  res.render('pages/reset-password', {
    title: 'Reset Password — Con Leche',
    error: null, success: null, token: req.params.token, valid: true
  });
});

router.post('/reset-password/:token', resetLimiter, async (req, res) => {
  try {
    const user = await User.findOne({
      resetToken: req.params.token,
      resetTokenExpiry: { $gt: new Date() }
    });
    if (!user) {
      return res.render('pages/reset-password', {
        title: 'Reset Password', error: 'Link expired — please request a new one.',
        success: null, token: null, valid: false
      });
    }
    const password        = asString(req.body.password, 200);
    const confirmPassword = asString(req.body.confirmPassword, 200);
    if (password !== confirmPassword) {
      return res.render('pages/reset-password', {
        title: 'Reset Password', error: 'Passwords do not match.',
        success: null, token: req.params.token, valid: true
      });
    }
    if (password.length < 8) {
      return res.render('pages/reset-password', {
        title: 'Reset Password', error: 'Password must be at least 8 characters.',
        success: null, token: req.params.token, valid: true
      });
    }
    user.password         = password; // pre-save hook hashes it
    user.resetToken       = null;
    user.resetTokenExpiry = null;
    await user.save();

    res.render('pages/login', {
      title: 'Sign In — Con Leche',
      error: null,
      success: 'Password updated! You can now sign in with your new password.'
    });
  } catch (err) {
    console.error(err);
    res.render('pages/reset-password', {
      title: 'Reset Password', error: 'Something went wrong.',
      success: null, token: req.params.token, valid: true
    });
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
