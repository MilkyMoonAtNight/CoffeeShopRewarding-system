const express = require('express');
const router = express.Router();
const User = require('../models/User');
const QRCode = require('qrcode');
const crypto = require('crypto');

// Register
router.get('/register', (req, res) => {
  res.render('pages/register', { title: 'Join the Pack — Con Leche', error: null });
});

router.post('/register', async (req, res) => {
  try {
    const { name, email, password, confirmPassword } = req.body;
    if (password !== confirmPassword) {
      return res.render('pages/register', { title: 'Join the Pack', error: 'Passwords do not match' });
    }
    const exists = await User.findOne({ email });
    if (exists) {
      return res.render('pages/register', { title: 'Join the Pack', error: 'Email already registered' });
    }
    const qrToken = crypto.randomBytes(16).toString('hex');
    const user = new User({ name, email, password, qrCode: qrToken });
    await user.save();
    req.session.userId = user._id;
    req.session.userName = user.name;
    res.redirect('/battlepass');
  } catch (err) {
    console.error(err);
    res.render('pages/register', { title: 'Join the Pack', error: 'Something went wrong. Try again.' });
  }
});

// Login
router.get('/login', (req, res) => {
  res.render('pages/login', { title: 'Sign In — Con Leche', error: null });
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user || !(await user.comparePassword(password))) {
      return res.render('pages/login', { title: 'Sign In', error: 'Invalid email or password' });
    }
    req.session.userId = user._id;
    req.session.userName = user.name;
    res.redirect('/battlepass');
  } catch (err) {
    console.error(err);
    res.render('pages/login', { title: 'Sign In', error: 'Something went wrong.' });
  }
});

// Logout
router.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

module.exports = router;
