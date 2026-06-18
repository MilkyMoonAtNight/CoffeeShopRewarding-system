---
name: payments-bypassed-for-testing
description: Ozow live payments are intentionally disabled behind an env flag for order-flow testing
metadata:
  type: project
---

As of 2026-06-18, live Ozow payments are intentionally bypassed so the ordering flow can be tested end to end.

**Why:** Iwan needed to test ordering on real devices (via ngrok) without a working payment gateway.

**How it works:** In [routes/payment.js](routes/payment.js), `/payment/initiate` checks `process.env.PAYMENTS_ENABLED`. When it is not `'true'` (the current default), it skips the Ozow redirect, marks the order `paymentStatus: 'paid'`, and redirects to the new virtual slip at `/order/slip/:ref`.

**To restore real Ozow:** set `PAYMENTS_ENABLED=true` in the env. The original Ozow hash/redirect code is untouched below the bypass block.

The virtual slip view is [views/pages/order-slip.ejs](views/pages/order-slip.ejs); both "pay online" and "pay in store" now land there.
