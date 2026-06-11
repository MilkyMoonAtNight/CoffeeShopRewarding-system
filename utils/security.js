// ── Shared security helpers & middleware ──────────────────────────
// Lightweight, dependency-free protections used across the app.

// ----------------------------------------------------------------------------
// 1. NoSQL-injection sanitiser
// ----------------------------------------------------------------------------
// Recursively strips any object keys that start with "$" or contain ".".
// These are the operators Mongo/Mongoose interpret (e.g. {$ne:null}, {$gt:""}),
// which is how an attacker turns  findOne({ email })  into an auth-bypass /
// account-enumeration probe by sending  email[$ne]=null  in the body or query.
// After sanitising, a value like { $ne: null } simply disappears, leaving the
// query to look up a literal — exactly what the code intended.
function scrub(value) {
  if (Array.isArray(value)) {
    return value.map(scrub);
  }
  if (value && typeof value === 'object') {
    const clean = {};
    for (const key of Object.keys(value)) {
      if (key.startsWith('$') || key.includes('.')) continue; // drop operator keys
      clean[key] = scrub(value[key]);
    }
    return clean;
  }
  return value;
}

function mongoSanitize(req, res, next) {
  // req.query is a getter on a frozen object in newer Express — mutate in place.
  if (req.body)   req.body   = scrub(req.body);
  if (req.params) req.params = scrub(req.params);
  if (req.query) {
    const cleaned = scrub(req.query);
    for (const k of Object.keys(req.query)) delete req.query[k];
    Object.assign(req.query, cleaned);
  }
  next();
}

// ----------------------------------------------------------------------------
// 2. Coerce a value to a plain trimmed string (defence-in-depth for queries)
// ----------------------------------------------------------------------------
function asString(value, maxLen = 1000) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') {
    // Objects/arrays => empty string so they can never become a query operator.
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    return '';
  }
  return value.slice(0, maxLen).trim();
}

// ----------------------------------------------------------------------------
// 3. Strip HTML / control characters from free-text user input
// ----------------------------------------------------------------------------
// Used on order names, notes, etc. before they are stored. Combined with output
// escaping this stops stored-XSS from reaching the admin dashboard.
function cleanText(value, maxLen = 500) {
  return asString(value, maxLen).replace(/[<>]/g, '');
}

// ----------------------------------------------------------------------------
// 4. Security response headers (clickjacking / MIME-sniffing / referrer / CSP)
// ----------------------------------------------------------------------------
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '0'); // rely on CSP, disable legacy buggy filter
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(self)');
  // Conservative CSP: allow same-origin assets + inline styles/scripts the
  // templates already use, plus the QR data-URIs and the Ozow redirect target.
  res.setHeader(
    'Content-Security-Policy',
    [
      "default-src 'self'",
      "img-src 'self' data:",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com data:",
      "connect-src 'self'",
      "form-action 'self' https://pay.ozow.com",
      "frame-ancestors 'self'",
      "object-src 'none'",
      "base-uri 'self'",
    ].join('; ')
  );
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
}

// ----------------------------------------------------------------------------
// 5. Minimal in-memory rate limiter (per IP + bucket)
// ----------------------------------------------------------------------------
// Good enough to blunt password brute-force, reset-spam and injection probing
// on a single-instance deployment. For multi-instance, swap for a Redis store.
function rateLimit({ windowMs = 15 * 60 * 1000, max = 30, message = 'Too many requests, please try again later.' } = {}) {
  const hits = new Map(); // key -> { count, resetAt }
  // periodic cleanup so the map can't grow unbounded
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }, windowMs).unref?.();

  return function (req, res, next) {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const key = `${ip}:${req.baseUrl}${req.path}`;
    const now = Date.now();
    let rec = hits.get(key);
    if (!rec || rec.resetAt <= now) {
      rec = { count: 0, resetAt: now + windowMs };
      hits.set(key, rec);
    }
    rec.count += 1;
    if (rec.count > max) {
      const retry = Math.ceil((rec.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retry));
      if (req.accepts('json') && !req.accepts('html')) {
        return res.status(429).json({ ok: false, error: message });
      }
      return res.status(429).send(message);
    }
    next();
  };
}

module.exports = {
  mongoSanitize,
  securityHeaders,
  rateLimit,
  asString,
  cleanText,
  scrub,
};
