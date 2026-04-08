const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const db = require('../db/database');
const { loginLimiter, registerLimiter } = require('../middleware/rateLimiter');

// Login page
router.get('/login', (req, res) => {
  if (req.session && req.session.userId) return res.redirect('/dashboard');
  res.render('auth/login', { title: 'Login - SecureVote' });
});

// Login handler
router.post('/login', loginLimiter, [
  body('username').trim().notEmpty().escape(),
  body('password').notEmpty(),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.session.error = 'Invalid input.';
    return res.redirect('/auth/login');
  }

  const { username, password } = req.body;
  const user = db.getUserByUsername(username);

  if (!user) {
    db.logAudit({ action: 'LOGIN_FAILED', details: `Unknown user: ${username}`, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    req.session.error = 'Invalid username or password.';
    return res.redirect('/auth/login');
  }

  if (user.is_locked) {
    db.logAudit({ userId: user.id, action: 'LOGIN_BLOCKED', details: 'Account locked', ipAddress: req.ip, userAgent: req.get('User-Agent') });
    req.session.error = 'Account is locked. Contact an administrator.';
    return res.redirect('/auth/login');
  }

  if (!db.verifyPassword(password, user.password_hash)) {
    const attempts = user.failed_login_attempts + 1;
    db.updateLoginAttempts(user.id, attempts);
    db.logAudit({ userId: user.id, action: 'LOGIN_FAILED', details: `Attempt ${attempts}/5`, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    
    if (attempts >= 5) {
      req.session.error = 'Account has been locked due to too many failed attempts.';
    } else {
      req.session.error = `Invalid password. ${5 - attempts} attempts remaining.`;
    }
    return res.redirect('/auth/login');
  }

  // Successful login - regenerate session
  req.session.regenerate((err) => {
    if (err) {
      req.session.error = 'Session error. Please try again.';
      return res.redirect('/auth/login');
    }
    req.session.userId = user.id;
    req.session.role = user.role;
    db.resetLoginAttempts(user.id);
    db.logAudit({ userId: user.id, action: 'LOGIN_SUCCESS', ipAddress: req.ip, userAgent: req.get('User-Agent') });

    if (user.role === 'admin') {
      res.redirect('/admin');
    } else {
      res.redirect('/dashboard');
    }
  });
});

// Register page
router.get('/register', (req, res) => {
  if (req.session && req.session.userId) return res.redirect('/dashboard');
  res.render('auth/register', { title: 'Register - SecureVote' });
});

// Register handler
router.post('/register', registerLimiter, [
  body('studentId').trim().notEmpty().isLength({ min: 3, max: 20 }).escape(),
  body('email').trim().isEmail().normalizeEmail(),
  body('username').trim().isLength({ min: 3, max: 30 }).matches(/^[a-zA-Z0-9_]+$/).escape(),
  body('password').isLength({ min: 8 }).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])/),
  body('confirmPassword').custom((value, { req }) => value === req.body.password),
  body('fullName').trim().notEmpty().isLength({ min: 2, max: 100 }).escape(),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.session.error = 'Validation failed. Password must be 8+ chars with uppercase, lowercase, number, and special character. Username must be alphanumeric.';
    return res.redirect('/auth/register');
  }

  const { studentId, email, username, password, fullName } = req.body;

  try {
    const userId = db.createUser({ studentId, email, username, password, fullName });
    db.logAudit({ userId, action: 'REGISTER', details: `New voter registered: ${username}`, ipAddress: req.ip, userAgent: req.get('User-Agent') });
    req.session.success = 'Registration successful! You can now log in.';
    res.redirect('/auth/login');
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      req.session.error = 'Student ID, email, or username already exists.';
    } else {
      req.session.error = 'Registration failed. Please try again.';
    }
    res.redirect('/auth/register');
  }
});

// Logout
router.post('/logout', (req, res) => {
  const userId = req.session.userId;
  if (userId) {
    db.logAudit({ userId, action: 'LOGOUT', ipAddress: req.ip, userAgent: req.get('User-Agent') });
  }
  req.session.destroy((err) => {
    res.clearCookie('securevote.sid');
    res.redirect('/auth/login');
  });
});

module.exports = router;
