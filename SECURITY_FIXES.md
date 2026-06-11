# Security Audit & Fixes — Con Leche Coffee Rewards

Stack: Node.js / Express 4 / EJS / Mongoose (MongoDB). "SQL injection" in this
codebase means **NoSQL (Mongo operator) injection**, since the data layer is MongoDB.
There are no shell/`exec`/`child_process` calls, so there was no classic command-injection
surface — but several other real vulnerabilities were present and have been fixed.

All changes were syntax-checked, the full app was loaded successfully, and the
sanitiser / XSS-escaping logic was unit-tested.

---

## Critical

### 1. Unauthenticated staff endpoints (broken access control)  — `routes/battlepass.js`
`POST /battlepass/scan` and `POST /battlepass/confirm-claim` had **no authentication**.
Anyone on the internet could POST a `qrCode` to record loyalty drinks (and trip free-drink
/ reward milestones) for any customer, or confirm reward claims. Combined with the NoSQL
issue below (`qrCode[$ne]=null`), an attacker didn't even need a valid QR code — they could
match the first user in the collection.

**Fix:** added a `requireAdminApi` guard (verifies `req.session.adminId` maps to an active
admin) on both routes, and coerced `qrCode` / `rewardId` / `code` to plain strings.

### 2. NoSQL operator injection  — global, all query-building routes
User input flowed straight into Mongo queries, e.g. `User.findOne({ email })`,
`Admin.findOne({ email, active:true })`, `User.findOne({ qrCode })`. Because the body
parser accepts nested objects, a request like `email[$ne]=null` (or a JSON body
`{"email":{"$ne":null}}`) turns the lookup into "return the first user", enabling account
enumeration, reset-token abuse and reward fraud.

**Fix:** added a global `mongoSanitize` middleware (`utils/security.js`) that recursively
strips any key starting with `$` or containing `.` from `req.body`, `req.query` and
`req.params`. As defence-in-depth, security-sensitive fields are also explicitly coerced to
strings via `asString()` so an object can never reach a query.

### 3. Stored XSS in the staff Orders dashboard  — `views/admin/orders.ejs`
The dashboard builds its HTML with `innerHTML` from order data
(`userName`, item `name`/`notes`/`image`, order `notes`, …) that is **supplied by the
customer** at checkout. A customer ordering with a name/note of
`<img src=x onerror=…>` would execute script in a logged-in admin's browser when they open
the dashboard — a path to full admin-account takeover.

**Fix (two layers):**
- Output: added an `esc()` HTML-escaper and applied it to every customer-controlled value
  rendered into `innerHTML`.
- Input: `POST /order/place` now strips `<`/`>` and length-limits every free-text field
  (`utils/security.cleanText`) before storing.

---

## High

### 4. Malicious SVG / arbitrary-file upload  — `routes/admin.js`
The image uploader **accepted SVG** and `application/octet-stream`, and treated the upload
as valid if *either* the MIME type *or* the extension looked acceptable. SVGs are served
inline from `/public/images/...`, and an SVG can embed `<script>` — stored XSS. The loose
filter also let non-image files through.

**Fix:** restricted to raster images only (`jpg/jpeg/png/webp/gif`), removed SVG and
`octet-stream`, and now require **both** a whitelisted MIME type **and** a whitelisted
extension. The saved filename's extension is whitelisted too.

### 5. Price / total tampering  — `routes/order.js`, `routes/payment.js`
`POST /order/place` trusted the client-supplied `total` verbatim, and `/payment/initiate`
sent a client-supplied amount to the payment gateway. A user could pay R1 for an R500 order.

**Fix:** the order total is now **recomputed server-side** from the (sanitised) line items
and the client `total` is ignored; the payment amount is validated as a finite, positive
number and the order reference is restricted to safe characters.
**Residual note:** `item.price` still originates from the client. For complete integrity the
unit price should be looked up from the `Drink`/`Pastry` collections server-side — this needs
your pricing rules (size, milk surcharge, flavour) and is flagged with a `NOTE:` comment in
`routes/order.js`.

---

## Medium

### 6. No brute-force / abuse protection  — auth & reset endpoints
Login, registration, forgot-password and reset-password had no throttling, allowing
password brute-forcing, account enumeration and reset-email spam.

**Fix:** added a small in-memory `rateLimit` middleware and applied it (10 tries / 15 min on
login & register; 5 / hour on the reset endpoints).

### 7. Weak input validation  — registration & staff creation
Registration enforced no email format and no password length (reset did). Staff creation
didn't validate the role.

**Fix:** registration now requires a valid email and an 8+ char password; staff creation
validates the role against the allowed set and enforces an 8+ char password.

### 8. Unvalidated order status  — `routes/order.js`
`POST /order/status/:userId/:ref` wrote any string into the order status (then emailed it
to the customer). **Fix:** status is validated against a fixed allow-list.

### 9. `<script>` JSON breakout  — `drinks.ejs`, `pastries.ejs`, `drink-detail.ejs`
Menu data is injected via `<%- JSON.stringify(...) %>` inside a `<script>` block; a value
containing `</script>` would break out. **Fix:** `<` is escaped to `\u003c` (verified with a
render test — the value is preserved, the breakout is not).

---

## Hardening (defence-in-depth)

- **Security headers** (`securityHeaders`): `Content-Security-Policy`, `X-Content-Type-Options:
  nosniff`, `X-Frame-Options: SAMEORIGIN` (clickjacking), `Referrer-Policy`,
  `Permissions-Policy`, and HSTS in production.
- **Session cookie**: now explicitly `httpOnly`, `sameSite: 'lax'` (mitigates CSRF for the
  cookie-based session), `secure` in production, and renamed off the default.
- **Request body size** capped at 100 kb (basic DoS guard).
- **`x-powered-by`** disabled; `trust proxy` set in production for correct secure-cookie /
  client-IP handling.
- **`/admin/setup`** can now be gated with an optional `SETUP_KEY` env var so it can't be
  abused to seed owner accounts if the admin collection is ever emptied.

---

## Action items for you (not code changes)

1. **Rotate the secrets in `.env`** — they were shipped inside the project archive and must
   be treated as compromised: the MongoDB connection string/password, `SESSION_SECRET`,
   `NFC_TOKEN`, and especially the Gmail app password (`EMAIL_PASS`). You said the DB/admin
   passwords change on deploy — please make sure the email app-password and session secret
   are rotated too.
2. **Change the seeded `admin` passwords** immediately after first login (as you noted).
3. **Set in production:** `NODE_ENV=production` (enables secure cookies + HSTS), a strong
   `SESSION_SECRET`, and optionally `SETUP_KEY`. Set `BASE_URL` for the payment/email links.
4. **Recommended follow-up — CSRF tokens.** `sameSite: 'lax'` covers most CSRF, but for
   defence-in-depth add per-session synchroniser tokens to the state-changing forms and
   `fetch` calls (login, register, order placement, admin actions). This touches many views,
   so it was left as a deliberate, separate task rather than a partial/breaking change.
5. **Daily check-in PIN** uses MD5 truncated to 4 hex chars (~65k combos). Fine for low-stakes
   attendance, but don't reuse that scheme for anything sensitive.
6. Run `npm audit` after deploy to catch any vulnerable transitive dependencies.

---

### Files changed
`app.js`, `utils/security.js` (new), `routes/auth.js`, `routes/admin.js`,
`routes/battlepass.js`, `routes/order.js`, `routes/payment.js`,
`views/admin/orders.ejs`, `views/pages/drinks.ejs`, `views/pages/pastries.ejs`,
`views/pages/drink-detail.ejs`.
