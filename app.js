require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'conleche_secret',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
  cookie: {
    secure: process.env.NODE_ENV === 'production',
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
app.use('/',           require('./routes/auth'));
app.use('/',           require('./routes/index'));

// 404 — proper response, not redirect to home
app.use((req, res) => {
  res.status(404).send('<h2>404 — Page not found</h2><a href="/">Go home</a>');
});

// Start server immediately — don't wait for MongoDB
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✓ Con Leche running on port ${PORT}`);
});

mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://...')
  .then(() => console.log('✓ Connected to MongoDB'))
  .catch(err => console.error('MongoDB connection error:', err.message));

module.exports = app;
