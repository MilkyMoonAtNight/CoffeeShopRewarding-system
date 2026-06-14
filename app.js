const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);

require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const path = require('path');
const { mongoSanitize, securityHeaders } = require('./utils/security');

const app = express();
const PORT = process.env.PORT || 3000;

// Hide framework fingerprint; trust the first proxy in production so that
// secure cookies and req.ip (rate limiting) work behind a load balancer / TLS terminator.
app.disable('x-powered-by');
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(securityHeaders);

app.use(express.static(path.join(__dirname, 'public')));
// Cap body size to limit abuse / DoS via huge payloads.
app.use(express.urlencoded({ extended: true, limit: '100kb' }));
app.use(express.json({ limit: '100kb' }));

// Strip Mongo operator keys ($ne, $gt, …) from all user input — neutralises
// NoSQL injection across every route that builds a query from req.body/query/params.
app.use(mongoSanitize);

app.use(session({
  name: 'conleche.sid',
  secret: process.env.SESSION_SECRET || 'conleche_secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,                                   // not readable from JS (XSS cookie theft)
    sameSite: 'lax',                                  // blocks cross-site CSRF for cookie auth
    secure: process.env.NODE_ENV === 'production',    // HTTPS-only in production
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

app.use((req, res, next) => {
  res.locals.session = req.session;
  next();
});

// Routes — order matters, most specific first
app.use('/admin',      require('./routes/admin'));
app.use('/battlepass', require('./routes/battlepass'));
app.use('/order',      require('./routes/order'));
app.use('/payment',    require('./routes/payment'));
app.use('/',           require('./routes/auth'));
app.use('/',           require('./routes/index'));

// 404 — proper response, not redirect to home
app.use((req, res) => {
  res.status(404).send('<h2>404 — Page not found</h2><a href="/">Go home</a>');
});

const { startScheduler } = require('./utils/scheduler');

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log('✓ Connected to MongoDB');
    startScheduler();
    app.listen(PORT, () => console.log(`✓ Con Leche running at http://localhost:${PORT}`));
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
    app.listen(PORT, () => console.log(`⚠ Running WITHOUT MongoDB at http://localhost:${PORT}`));
  });

module.exports = app;
