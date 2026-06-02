require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
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
  cookie: { secure: false, maxAge: 7 * 24 * 60 * 60 * 1000 }
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

mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://iwangroenewald14_db_user:ConLecheCoffeeShop@cluster0.vri5avz.mongodb.net/conleche')
  .then(() => {
    console.log('✓ Connected to MongoDB');
    app.listen(PORT, () => console.log(`✓ Con Leche running at http://localhost:${PORT}`));
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
    app.listen(PORT, () => console.log(`⚠ Running WITHOUT MongoDB at http://localhost:${PORT}`));
  });

module.exports = app;
