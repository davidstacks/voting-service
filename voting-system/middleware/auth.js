const db = require('../db/database');

// Check if user is authenticated
function isAuthenticated(req, res, next) {
  if (req.session && req.session.userId) {
    const user = db.getUserById(req.session.userId);
    if (user && !user.is_locked) {
      req.user = user;
      res.locals.user = user;
      return next();
    }
    req.session.destroy();
  }
  res.redirect('/auth/login');
}

// Check if user is admin
function isAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') {
    return next();
  }
  res.status(403).render('error', { 
    title: 'Access Denied', 
    message: 'You do not have permission to access this page.',
    code: 403 
  });
}

// Check if user is verified voter
function isVerifiedVoter(req, res, next) {
  if (req.user && req.user.is_verified) {
    return next();
  }
  res.status(403).render('error', { 
    title: 'Not Verified', 
    message: 'Your account must be verified before you can vote. Please contact an administrator.',
    code: 403
  });
}

// Set common locals
function setLocals(req, res, next) {
  res.locals.user = req.user || null;
  res.locals.success = req.session.success || null;
  res.locals.error = req.session.error || null;
  delete req.session.success;
  delete req.session.error;
  next();
}

module.exports = { isAuthenticated, isAdmin, isVerifiedVoter, setLocals };
