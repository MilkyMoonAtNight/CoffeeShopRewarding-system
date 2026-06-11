const express = require('express');
const router  = express.Router();
const crypto  = require('crypto');
const User    = require('../models/User');
const { asString } = require('../utils/security');

function requireUser(req, res, next) {
  if (!req.session.userId) return res.redirect('/login');
  next();
}

function generateOzowHash(fields, privateKey) {
  const input = Object.values(fields).join('').toLowerCase() + privateKey.toLowerCase();
  return crypto.createHash('sha512').update(input).digest('hex');
}

// ── Initiate payment ──────────────────────────────────────────────
router.post('/initiate', requireUser, async (req, res) => {
  try {
    const orderRef      = asString(req.body.orderRef, 60).replace(/[^A-Za-z0-9\-_]/g, '');
    const customerEmail = asString(req.body.customerEmail, 200);
    const amountNum     = Number(req.body.total);
    if (!orderRef) return res.redirect('/order/confirm?error=payment_failed');
    if (!Number.isFinite(amountNum) || amountNum <= 0) return res.redirect('/order/confirm?error=payment_failed');
    const isTest = process.env.NODE_ENV !== 'production';

    const fields = {
      SiteCode:             process.env.OZOW_SITE_CODE,
      CountryCode:          'ZA',
      CurrencyCode:         'ZAR',
      Amount:               amountNum.toFixed(2),
      TransactionReference: orderRef,
      BankReference:        `ConLeche-${orderRef}`,
      Optional1:            '',
      Optional2:            '',
      Optional3:            '',
      Optional4:            '',
      Optional5:            '',
      Customer:             customerEmail || '',
      IsTest:               isTest ? 'true' : 'false',
      SuccessUrl:           `${process.env.BASE_URL}/payment/success`,
      ErrorUrl:             `${process.env.BASE_URL}/payment/error`,
      CancelUrl:            `${process.env.BASE_URL}/payment/cancel`,
      NotifyUrl:            `${process.env.BASE_URL}/payment/notify`,
    };

    fields.HashCheck = generateOzowHash(fields, process.env.OZOW_PRIVATE_KEY);

    res.render('pages/payment-redirect', {
      title:    'Redirecting to Ozow — Con Leche',
      fields,
      ozowUrl:  'https://pay.ozow.com',
    });
  } catch (err) {
    console.error('Ozow initiate error:', err);
    res.redirect('/order/confirm?error=payment_failed');
  }
});

// ── Notify webhook (called by Ozow server-to-server) ─────────────
router.post('/notify', express.urlencoded({ extended: true }), async (req, res) => {
  try {
    const {
      SiteCode, TransactionId, TransactionReference,
      Amount, Status, HashCheck,
    } = req.body;

    // Verify the hash to confirm this is genuinely from Ozow
    const fields = { SiteCode, TransactionId, TransactionReference, Amount, Status };
    const expected = generateOzowHash(fields, process.env.OZOW_PRIVATE_KEY);

    if (expected.toLowerCase() !== (HashCheck || '').toLowerCase()) {
      console.warn('Ozow notify: hash mismatch');
      return res.status(400).send('Invalid hash');
    }

    if (Status === 'Complete') {
      await User.updateOne(
        { 'pastOrders.ref': TransactionReference },
        { $set: {
          'pastOrders.$.status':    'paid',
          'pastOrders.$.paymentId': TransactionId,
        }}
      );
    }

    res.status(200).send('OK');
  } catch (err) {
    console.error('Ozow notify error:', err);
    res.status(500).send('Error');
  }
});

// ── Success / cancel / error pages ───────────────────────────────
router.get('/success', requireUser, (req, res) => {
  res.render('pages/payment-success', { title: 'Payment Successful — Con Leche' });
});
router.get('/cancel', requireUser, (req, res) => {
  res.render('pages/payment-cancel', { title: 'Payment Cancelled — Con Leche' });
});
router.get('/error', requireUser, (req, res) => {
  res.render('pages/payment-error', { title: 'Payment Error — Con Leche' });
});

module.exports = router;
