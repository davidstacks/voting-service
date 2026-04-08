require('dotenv').config();
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');
const crypto = require('crypto');
const db = require('./db/database');
const { generalLimiter } = require('./middleware/rateLimiter');
const { setLocals } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize database
db.initialize();

// Security headers via Helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// Disable X-Powered-By
app.disable('x-powered-by');

// Body parsers
app.use(express.urlencoded({ extended: false, limit: '10kb' }));
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser(process.env.COOKIE_SECRET || 'securevote-cookie-secret-change-in-production'));

// Session configuration
app.use(session({
  name: 'securevote.sid',
  secret: process.env.SESSION_SECRET || crypto.randomBytes(64).toString('hex'),
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    maxAge: 30 * 60 * 1000, // 30 minutes
  },
}));

// Rate limiting
app.use(generalLimiter);

// Static files
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Set common locals
app.use(setLocals);

// Routes
app.get('/', (req, res) => {
  if (req.session && req.session.userId) {
    return res.redirect(req.session.role === 'admin' ? '/admin' : '/dashboard');
  }
  res.render('landing', { title: 'SecureVote - Secure Voting for Schools & Organizations' });
});

app.use('/auth', require('./routes/auth'));
app.use('/dashboard', require('./routes/voter'));
app.use('/admin', require('./routes/admin'));

// 404
app.use((req, res) => {
  res.status(404).render('error', { title: '404 - Not Found', message: 'Page not found.', code: 404 });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  db.logAudit({ action: 'SERVER_ERROR', details: err.message, ipAddress: req.ip, userAgent: req.get('User-Agent') });
  res.status(500).render('error', { title: '500 - Server Error', message: 'An internal error occurred.', code: 500 });
});

app.listen(PORT, () => {
  console.log(`\n🗳️  SecureVote is running at http://localhost:${PORT}`);
  console.log(`🔒 Enterprise-grade security enabled`);
  console.log(`📊 Admin panel: http://localhost:${PORT}/admin\n`);
});
