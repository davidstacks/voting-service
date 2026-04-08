require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');
const crypto = require('crypto');
const { validationResult, body } = require('express-validator');
const db = require('./db/database');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// Trust reverse proxy (nginx, cloudflare, render, railway, etc.)
app.set('trust proxy', IS_PROD ? 1 : false);

db.initialize();

// Security
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'self'"],
      styleSrc:       ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      fontSrc:        ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      scriptSrc:      ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com", "https://cdn.jsdelivr.net"],
      scriptSrcAttr:  ["'unsafe-inline'"],
      imgSrc:         ["'self'", "data:", "https:"],
      frameSrc:       ["'self'"],
      frameAncestors: ["*"],
      connectSrc:     ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  hsts: IS_PROD ? { maxAge: 31536000, includeSubDomains: true } : false,
}));
app.disable('x-powered-by');

// Parsers
app.use(express.urlencoded({ extended: false, limit: '10kb' }));
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser(process.env.COOKIE_SECRET || 'gvote-cookie-secret'));

// Session
app.use(session({
  name: 'gvote.sid',
  secret: process.env.SESSION_SECRET || crypto.randomBytes(64).toString('hex'),
  resave: false,
  saveUninitialized: true,
  cookie: {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));

// Rate limiting
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, max: 500,
  standardHeaders: true, legacyHeaders: false,
  skip: (req) => req.path.startsWith('/css') || req.path.startsWith('/js'),
}));

const voteLimiter = rateLimit({
  windowMs: 60 * 1000, max: 10,
  message: 'Too many requests. Please slow down.',
  standardHeaders: true, legacyHeaders: false,
});

const createLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, max: 30,
  message: 'Too many polls created. Try again later.',
  standardHeaders: true, legacyHeaders: false,
});

// Static & Views
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1d' }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Flash messages + CSRF token
app.use((req, res, next) => {
  res.locals.success = req.session.success; delete req.session.success;
  res.locals.error   = req.session.error;   delete req.session.error;
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(32).toString('hex');
  res.locals.csrf = req.session.csrf;
  res.locals.myPollCount = req.session.myPolls ? req.session.myPolls.length : 0;
  next();
});

// CSRF verification for state-changing POST routes
function verifyCsrf(req, res, next) {
  const token = req.body._csrf;
  if (!token || token !== req.session.csrf) {
    return sendError(res, 403, 'Invalid form token. Please go back and try again.');
  }
  next();
}

// Wrap async route handlers — propagates thrown errors to Express error handler
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// Safe error renderer — falls back to plain HTML if the error view itself fails
function sendError(res, code, message) {
  try {
    res.status(code).render('error', { title: `${code}`, message, code });
  } catch (_) {
    res.status(code).send(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${code} — GVote</title></head><body style="font-family:sans-serif;text-align:center;padding:4rem;background:#060818;color:#f0f4ff"><h1 style="font-size:5rem;color:#7c3aed;margin:0">${code}</h1><p style="color:#94a3b8">${message}</p><a href="/" style="display:inline-block;margin-top:1.5rem;padding:.7rem 1.5rem;background:#7c3aed;color:#fff;border-radius:10px;text-decoration:none">Go Home</a></body></html>`);
  }
}

function getClientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

// ===== ROUTES =====

// Prevent 404 noise for common browser requests
app.get('/favicon.ico', (req, res) => res.status(204).end());
app.get('/health',      (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// Redirect legacy/stale auth routes so they don't return 500
app.get('/auth/login',  (req, res) => res.redirect('/'));
app.get('/auth/logout', (req, res) => res.redirect('/'));
app.get('/login',       (req, res) => res.redirect('/'));

// Landing page
app.get('/', asyncHandler(async (req, res) => {
  const stats = db.getPlatformStats();
  const recentPolls = db.getRecentPolls(6);
  const popularPolls = db.getPopularPolls(6);
  const myPollCount = req.session.myPolls ? req.session.myPolls.length : 0;
  res.render('landing', { title: 'GVote — Free Voting Hosting Platform', stats, recentPolls, popularPolls });
}));

// Explore page
app.get('/explore', asyncHandler(async (req, res) => {
  const { q, category, sort, page } = req.query;
  const pageNum = parseInt(page) || 1;
  const result = db.searchPolls({ query: q, category: category || 'all', sort: sort || 'newest', page: pageNum, limit: 12 });
  res.render('explore', {
    title: 'Explore Votes — GVote',
    ...result,
    query: q || '',
    category: category || 'all',
    sort: sort || 'newest',
    categories: db.CATEGORIES,
  });
}));

// Dashboard — My Polls
app.get('/dashboard', asyncHandler(async (req, res) => {
  let myPolls = [];
  if (req.session.myPolls && req.session.myPolls.length > 0) {
    myPolls = db.getMyPollsByIds(req.session.myPolls);
  }
  res.render('dashboard', {
    title: 'My Polls — GVote',
    myPolls,
    categories: db.CATEGORIES,
  });
}));

// Create poll page
app.get('/create', (req, res) => {
  res.render('create', {
    title: 'Create a Vote — GVote',
    categories: db.CATEGORIES,
    pollTypes: db.POLL_TYPES,
  });
});

// Submit new poll
app.post('/create', createLimiter, verifyCsrf,
  [
    body('title').trim().notEmpty().withMessage('Title is required.').isLength({ max: 200 }),
    body('description').optional().isLength({ max: 1000 }),
    body('adminPassword').optional().isLength({ max: 100 }),
    body('accessCode').optional().isLength({ max: 50 }).withMessage('Access code max 50 chars.'),
    body('voteCap').optional({ checkFalsy: true }).isInt({ min: 1, max: 1000000 }).withMessage('Vote cap must be a number between 1 and 1,000,000.'),
    body('webhookUrl').optional({ checkFalsy: true }).isURL({ protocols: ['https'], require_protocol: true }).withMessage('Webhook URL must be a valid HTTPS URL.'),
  ],
  asyncHandler(async (req, res) => {
    const vErr = validationResult(req);
    if (!vErr.isEmpty()) { req.session.error = vErr.array()[0].msg; return res.redirect('/create'); }
  const { title, description, adminPassword, allowMultiple, showResults, requireName, endDate, startDate, voteCap, webhookUrl, category, pollType, isPublic, accessCode } = req.body;
  let { options } = req.body;

  if (!title || !title.trim()) {
    req.session.error = 'Please enter a title.';
    return res.redirect('/create');
  }

  if (title.trim().length > 200) {
    req.session.error = 'Title is too long (max 200 characters).';
    return res.redirect('/create');
  }

  // For choice type, validate options
  if (!pollType || pollType === 'choice') {
    if (!Array.isArray(options)) options = options ? [options] : [];
    options = options.map(o => (o || '').trim()).filter(o => o.length > 0);
    if (options.length < 2) {
      req.session.error = 'Please add at least 2 options.';
      return res.redirect('/create');
    }
    if (options.length > 50) {
      req.session.error = 'Maximum 50 options allowed.';
      return res.redirect('/create');
    }
  } else {
    options = [];
  }

  const result = db.createPoll({
      title: title.trim(),
      description: (description || '').trim() || null,
      options,
      adminPassword: adminPassword || null,
      allowMultiple: !!allowMultiple,
      showResults: showResults !== 'hide',
      maxVotes: 1,
      endDate: endDate || null,
      startDate: startDate || null,
      voteCap: voteCap || null,
      webhookUrl: (webhookUrl || '').trim() || null,
      requireName: !!requireName,
      category: category || 'general',
      pollType: pollType || 'choice',
      isPublic: isPublic !== 'private',
      sessionOwner: req.session.id,
      accessCode: (accessCode || '').trim() || null,
    });

    if (!req.session.myPolls) req.session.myPolls = [];
    req.session.myPolls.push(result.id);

    req.session.success = 'Vote created! Share the link to start collecting votes.';
    res.redirect(`/v/${result.slug}`);
  })
);

// Verify Access Code
app.post('/v/:slug/verify-access', asyncHandler(async (req, res) => {
  const poll = db.getPollBySlug(req.params.slug);
  if (!poll) return sendError(res, 404, 'Vote not found.');
  const { accessCode } = req.body;
  if (!accessCode || !db.verifyAccessCode(poll, accessCode)) {
    req.session.error = 'Incorrect access code. Please try again.';
    return res.redirect(`/v/${poll.slug}`);
  }
  if (!req.session.accessGranted) req.session.accessGranted = [];
  if (!req.session.accessGranted.includes(poll.id)) req.session.accessGranted.push(poll.id);
  res.redirect(`/v/${poll.slug}`);
}));

// Vote page — view & cast vote
app.get('/v/:slug', asyncHandler(async (req, res) => {
  const poll = db.getPollBySlug(req.params.slug);
  if (!poll) return sendError(res, 404, 'Vote not found.');

  const options    = db.getOptionsByPoll(poll.id);
  const isOwner    = req.session.myPolls && req.session.myPolls.includes(poll.id);
  const needsCode  = !!poll.access_code_hash && !isOwner
    && !(req.session.accessGranted && req.session.accessGranted.includes(poll.id));
  const voted = db.hasVoted(poll.id, null, req.session.id)
    || (req.session.votedPolls && req.session.votedPolls.includes(poll.id))
    || !!(req.signedCookies && req.signedCookies[`voted_${poll.slug}`]);

  const isExpired    = poll.end_date && new Date(poll.end_date) < new Date();
  const isScheduled  = !isOwner && poll.start_date && new Date(poll.start_date) > new Date();
  const canVote      = !needsCode && !poll.is_closed && !isExpired && !voted && !isScheduled;
  const showResults  = !needsCode && !isScheduled && (voted || poll.is_closed || isExpired || !!poll.show_results_before_end);

  const results   = showResults ? db.getPollResults(poll.id) : null;
  const comments  = !needsCode ? db.getComments(poll.id) : [];
  const catObj    = db.CATEGORIES.find(c => c.id === poll.category) || db.CATEGORIES[0];

  res.render('vote', {
    title: `${poll.title} — GVote`,
    poll, options, results, totalVotes: poll.total_votes, canVote, voted, showResults,
    isOwner, isExpired, needsCode, isScheduled, comments,
    categoryObj: catObj, categories: db.CATEGORIES,
  });
}));

// JSON API for live results
app.get('/v/:slug/results.json', (req, res) => {
  try {
    const poll = db.getPollBySlug(req.params.slug);
    if (!poll) return res.status(404).json({ error: 'Not found' });
    const results = db.getPollResults(poll.id);
    res.json({ totalVotes: poll.total_votes, results, isClosed: !!poll.is_closed });
  } catch (err) {
    res.status(500).json({ error: 'Server error' });
  }
});

// Embed view
app.get('/v/:slug/embed', (req, res) => {
  const poll = db.getPollBySlug(req.params.slug);
  if (!poll) return res.status(404).send('Not found');
  const options = db.getOptionsByPoll(poll.id);
  const results = db.getPollResults(poll.id);
  const voted = db.hasVoted(poll.id, null, req.session.id)
    || (req.session.votedPolls && req.session.votedPolls.includes(poll.id));
  const isExpired = poll.end_date && new Date(poll.end_date) < new Date();
  const canVote = !poll.is_closed && !isExpired && !voted;
  const showResults = voted || poll.is_closed || isExpired || poll.show_results_before_end;
  res.render('embed', {
    title: poll.title,
    poll, options, results, totalVotes: poll.total_votes, canVote, voted, showResults, isExpired,
  });
});

// Cast vote
app.post('/v/:slug/vote', voteLimiter, asyncHandler(async (req, res) => {
  const poll = db.getPollBySlug(req.params.slug);
  if (!poll) return sendError(res, 404, 'Vote not found.');

  // Access code guard
  const isOwner   = req.session.myPolls && req.session.myPolls.includes(poll.id);
  const needsCode = !!poll.access_code_hash && !isOwner
    && !(req.session.accessGranted && req.session.accessGranted.includes(poll.id));
  if (needsCode) { req.session.error = 'Access code required.'; return res.redirect(`/v/${poll.slug}`); }

  const { deviceFingerprint, voterName } = req.body;
  let { optionId } = req.body;

  if ((req.session.votedPolls && req.session.votedPolls.includes(poll.id))
      || (req.signedCookies && req.signedCookies[`voted_${poll.slug}`])) {
    req.session.error = 'You have already voted.';
    return res.redirect(`/v/${poll.slug}`);
  }

  if (!optionId) {
    req.session.error = 'Please select an option.';
    return res.redirect(`/v/${poll.slug}`);
  }

  if (!Array.isArray(optionId)) optionId = [optionId];

  db.castVote({
    pollId: poll.id,
    optionIds: optionId,
    voterName: (voterName || '').trim().substring(0, 100) || null,
    deviceFingerprint: deviceFingerprint || null,
    sessionId: req.session.id,
    userAgent: (req.get('User-Agent') || '').substring(0, 500),
    ipAddress: getClientIp(req),
  });

  if (!req.session.votedPolls) req.session.votedPolls = [];
  req.session.votedPolls.push(poll.id);

  res.cookie(`voted_${poll.slug}`, '1', {
    maxAge: 365 * 24 * 60 * 60 * 1000,
    httpOnly: true, signed: true, sameSite: 'lax', secure: IS_PROD,
  });

  req.session.success = 'Your vote has been recorded!';
  res.redirect(`/v/${poll.slug}`);
}));

// Admin: close/reopen/delete/duplicate poll
app.post('/v/:slug/admin', verifyCsrf, asyncHandler(async (req, res) => {
  const poll = db.getPollBySlug(req.params.slug);
  if (!poll) return sendError(res, 404, 'Vote not found.');

  const { action, adminPassword } = req.body;
  const isOwner = req.session.myPolls && req.session.myPolls.includes(poll.id);

  if (!isOwner) {
    if (!adminPassword || !db.verifyAdminPassword(poll, adminPassword)) {
      req.session.error = 'Incorrect admin password.';
      return res.redirect(`/v/${poll.slug}`);
    }
  }

  if (action === 'close') {
    db.closePoll(poll.id);
    req.session.success = 'Vote closed.';
  } else if (action === 'reopen') {
    db.reopenPoll(poll.id);
    req.session.success = 'Vote reopened.';
  } else if (action === 'delete') {
    db.deletePoll(poll.id);
    if (req.session.myPolls) {
      req.session.myPolls = req.session.myPolls.filter(id => id !== poll.id);
    }
    req.session.success = 'Vote deleted.';
    return res.redirect('/dashboard');
  } else if (action === 'duplicate') {
    const newPoll = db.duplicatePoll(poll.id, req.session.id);
    if (!req.session.myPolls) req.session.myPolls = [];
    req.session.myPolls.push(newPoll.id);
    req.session.success = 'Poll duplicated! Edit it below.';
    return res.redirect(`/v/${newPoll.slug}`);
  }

  res.redirect(`/v/${poll.slug}`);
}));

// Results page (standalone)
app.get('/v/:slug/results', asyncHandler(async (req, res) => {
  const poll = db.getPollBySlug(req.params.slug);
  if (!poll) return sendError(res, 404, 'Vote not found.');
  const results    = db.getPollResults(poll.id);
  const voters     = db.getPollVoters(poll.id);
  const comments   = db.getComments(poll.id);
  const isOwner    = req.session.myPolls && req.session.myPolls.includes(poll.id);
  res.render('results', {
    title: `Results: ${poll.title} — GVote`,
    poll, results, totalVotes: poll.total_votes, voters, isOwner, comments,
  });
}));

// Export results as CSV
app.get('/v/:slug/export.csv', asyncHandler(async (req, res) => {
  const poll = db.getPollBySlug(req.params.slug);
  if (!poll) return sendError(res, 404, 'Vote not found.');
  const results = db.getPollResults(poll.id);
  const rows = [['Option', 'Votes', 'Percentage']];
  results.forEach(r => {
    const pct = poll.total_votes > 0 ? ((r.vote_count / poll.total_votes) * 100).toFixed(1) : '0.0';
    rows.push([`"${r.label.replace(/"/g, '""')}"`, r.vote_count, `${pct}%`]);
  });
  rows.push(['', '', '']);
  rows.push(['"Total"', poll.total_votes, '100%']);
  const csv = rows.map(row => row.join(',')).join('\r\n');
  // Sanitize filename
  const filename = `gvote-${poll.slug}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}));

// REST API — list public polls
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });

app.get('/api/polls', apiLimiter, asyncHandler(async (req, res) => {
  const { category, sort, page } = req.query;
  const result = db.searchPolls({ query: '', category: category || 'all', sort: sort || 'newest', page: parseInt(page) || 1, limit: 20 });
  res.json({
    polls: result.polls,
    page: result.page,
    totalPages: result.totalPages,
    total: result.total,
  });
}));

// REST API — single poll with results
app.get('/api/polls/:slug', apiLimiter, asyncHandler(async (req, res) => {
  const poll = db.getPollBySlug(req.params.slug);
  if (!poll) return res.status(404).json({ error: 'Not found' });
  if (!poll.is_public) return res.status(403).json({ error: 'This poll is private' });
  const results = db.getPollResults(poll.id);
  const { admin_password_hash, access_code_hash, session_owner, ...safePoll } = poll;
  res.json({ poll: safePoll, results, totalVotes: poll.total_votes });
}));

// Post a comment
const commentLimiter = rateLimit({ windowMs: 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false });

app.post('/v/:slug/comment', commentLimiter, asyncHandler(async (req, res) => {
  const poll = db.getPollBySlug(req.params.slug);
  if (!poll) return res.status(404).json({ error: 'Not found' });

  const body = (req.body.body || '').trim();
  if (!body || body.length < 1) return res.status(400).json({ error: 'Comment cannot be empty.' });
  if (body.length > 1000) return res.status(400).json({ error: 'Comment too long (max 1000 chars).' });

  const authorName = (req.body.authorName || '').trim().substring(0, 100) || null;
  const result = db.addComment(poll.id, authorName, body);
  res.json({ success: true, id: result.id });
}));

// 404
app.use((req, res) => {
  sendError(res, 404, 'Page not found.');
});

// Error handler
app.use((err, req, res, next) => {
  console.error('SERVER ERROR:', err.stack);
  if (res.headersSent) return next(err);
  sendError(res, 500, 'Something went wrong on our end.');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\nGVote running on http://0.0.0.0:${PORT}`);
  console.log(`Create: http://localhost:${PORT}/create`);
  console.log(`Explore: http://localhost:${PORT}/explore\n`);
});
