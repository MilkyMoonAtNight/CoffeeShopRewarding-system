const express  = require('express');
const router   = express.Router();
const User     = require('../models/User');
const QRCode   = require('qrcode');
const crypto   = require('crypto');
const { sendPasswordReset } = require('../utils/mailer');

// ── REGISTER ──────────────────────────────────────────────────────
router.get('/register', (req, res) => {
  res.render('pages/register', { title: 'Join the Pack — Con Leche', error: null });
});

router.post('/register', async (req, res) => {
  try {
    const { name, email, password, confirmPassword } = req.body;
    if (password !== confirmPassword)
      return res.render('pages/register', { title: 'Join the Pack', error: 'Passwords do not match' });
    const exists = await User.findOne({ email });
    if (exists)
      return res.render('pages/register', { title: 'Join the Pack', error: 'Email already registered' });
    const qrToken = crypto.randomBytes(16).toString('hex');
    const user = new User({ name, email, password, qrCode: qrToken });
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

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
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

router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
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

router.post('/reset-password/:token', async (req, res) => {
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
    const { password, confirmPassword } = req.body;
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

module.exports = router;
