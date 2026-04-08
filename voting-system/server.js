require('dotenv').config();
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const path = require('path');
const crypto = require('crypto');
const db = require('./db/database');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

db.initialize();

// Security
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "https:"],
      frameSrc: ["'self'"],
      frameAncestors: ["*"],
    },
  },
  crossOriginEmbedderPolicy: false,
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
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));

// Rate limiting
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false }));

const voteLimiter = rateLimit({
  windowMs: 60 * 1000, max: 10,
  message: 'Too many requests. Please slow down.',
  standardHeaders: true, legacyHeaders: false,
  validate: { xForwardedForHeader: false, ip: false },
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

// Flash messages via session
app.use((req, res, next) => {
  res.locals.success = req.session.success; delete req.session.success;
  res.locals.error = req.session.error; delete req.session.error;
  next();
});

// ===== ROUTES =====

// Landing page
app.get('/', (req, res) => {
  const stats = db.getPlatformStats();
  const recentPolls = db.getRecentPolls(6);
  const popularPolls = db.getPopularPolls(6);
  const myPollCount = req.session.myPolls ? req.session.myPolls.length : 0;
  res.render('landing', { title: 'GVote — Free Voting Hosting Platform', stats, recentPolls, popularPolls, myPollCount });
});

// Explore page
app.get('/explore', (req, res) => {
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
});

// Dashboard — My Polls
app.get('/dashboard', (req, res) => {
  let myPolls = [];
  if (req.session.myPolls && req.session.myPolls.length > 0) {
    myPolls = db.getMyPollsByIds(req.session.myPolls);
  }
  res.render('dashboard', {
    title: 'My Polls — GVote',
    myPolls,
    categories: db.CATEGORIES,
  });
});

// Create poll page
app.get('/create', (req, res) => {
  res.render('create', {
    title: 'Create a Vote — GVote',
    categories: db.CATEGORIES,
    pollTypes: db.POLL_TYPES,
  });
});

// Submit new poll
app.post('/create', createLimiter, (req, res) => {
  const { title, description, adminPassword, allowMultiple, showResults, requireName, endDate, category, pollType, isPublic } = req.body;
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

  try {
    const result = db.createPoll({
      title: title.trim(),
      description: (description || '').trim() || null,
      options,
      adminPassword: adminPassword || null,
      allowMultiple: !!allowMultiple,
      showResults: showResults !== 'hide',
      maxVotes: 1,
      endDate: endDate || null,
      requireName: !!requireName,
      category: category || 'general',
      pollType: pollType || 'choice',
      isPublic: isPublic !== 'private',
      sessionOwner: req.session.id,
    });

    if (!req.session.myPolls) req.session.myPolls = [];
    req.session.myPolls.push(result.id);

    req.session.success = 'Vote created! Share the link to start collecting votes.';
    res.redirect(`/v/${result.slug}`);
  } catch (err) {
    req.session.error = err.message;
    res.redirect('/create');
  }
});

// Vote page — view & cast vote
app.get('/v/:slug', (req, res) => {
  const poll = db.getPollBySlug(req.params.slug);
  if (!poll) return res.status(404).render('error', { title: '404', message: 'Vote not found.', code: 404 });

  const options = db.getOptionsByPoll(poll.id);
  const voted = db.hasVoted(poll.id, null, req.session.id)
    || (req.session.votedPolls && req.session.votedPolls.includes(poll.id))
    || (req.signedCookies && req.signedCookies[`voted_${poll.slug}`]);

  const isExpired = poll.end_date && new Date(poll.end_date) < new Date();
  const canVote = !poll.is_closed && !isExpired && !voted;
  const showResults = voted || poll.is_closed || isExpired || poll.show_results_before_end;

  const results = showResults ? db.getPollResults(poll.id) : null;
  const totalVotes = poll.total_votes;
  const isOwner = req.session.myPolls && req.session.myPolls.includes(poll.id);

  const catObj = db.CATEGORIES.find(c => c.id === poll.category) || db.CATEGORIES[0];

  res.render('vote', {
    title: `${poll.title} — GVote`,
    poll, options, results, totalVotes, canVote, voted, showResults, isOwner, isExpired,
    categoryObj: catObj,
    categories: db.CATEGORIES,
  });
});

// JSON API for live results
app.get('/v/:slug/results.json', (req, res) => {
  const poll = db.getPollBySlug(req.params.slug);
  if (!poll) return res.status(404).json({ error: 'Not found' });
  const results = db.getPollResults(poll.id);
  res.json({ totalVotes: poll.total_votes, results, isClosed: !!poll.is_closed });
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
app.post('/v/:slug/vote', voteLimiter, (req, res) => {
  const poll = db.getPollBySlug(req.params.slug);
  if (!poll) return res.status(404).render('error', { title: '404', message: 'Vote not found.', code: 404 });

  const { deviceFingerprint, voterName } = req.body;
  let { optionId } = req.body;

  if (req.session.votedPolls && req.session.votedPolls.includes(poll.id)) {
    req.session.error = 'You have already voted.';
    return res.redirect(`/v/${poll.slug}`);
  }

  if (req.signedCookies && req.signedCookies[`voted_${poll.slug}`]) {
    req.session.error = 'You have already voted.';
    return res.redirect(`/v/${poll.slug}`);
  }

  if (!optionId) {
    req.session.error = 'Please select an option.';
    return res.redirect(`/v/${poll.slug}`);
  }

  if (!Array.isArray(optionId)) optionId = [optionId];

  try {
    db.castVote({
      pollId: poll.id,
      optionIds: optionId,
      voterName: voterName || null,
      deviceFingerprint: deviceFingerprint || null,
      sessionId: req.session.id,
      userAgent: req.get('User-Agent'),
    });

    if (!req.session.votedPolls) req.session.votedPolls = [];
    req.session.votedPolls.push(poll.id);

    res.cookie(`voted_${poll.slug}`, '1', {
      maxAge: 365 * 24 * 60 * 60 * 1000,
      httpOnly: true, signed: true, sameSite: 'lax',
    });

    req.session.success = 'Your vote has been recorded!';
    res.redirect(`/v/${poll.slug}`);
  } catch (err) {
    req.session.error = err.message;
    res.redirect(`/v/${poll.slug}`);
  }
});

// Admin: close/reopen/delete/duplicate poll
app.post('/v/:slug/admin', (req, res) => {
  const poll = db.getPollBySlug(req.params.slug);
  if (!poll) return res.status(404).render('error', { title: '404', message: 'Vote not found.', code: 404 });

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
    try {
      const newPoll = db.duplicatePoll(poll.id, req.session.id);
      if (!req.session.myPolls) req.session.myPolls = [];
      req.session.myPolls.push(newPoll.id);
      req.session.success = 'Poll duplicated! Edit it below.';
      return res.redirect(`/v/${newPoll.slug}`);
    } catch (err) {
      req.session.error = err.message;
    }
  }

  res.redirect(`/v/${poll.slug}`);
});

// Results page (standalone)
app.get('/v/:slug/results', (req, res) => {
  const poll = db.getPollBySlug(req.params.slug);
  if (!poll) return res.status(404).render('error', { title: '404', message: 'Vote not found.', code: 404 });

  const results = db.getPollResults(poll.id);
  const totalVotes = poll.total_votes;
  const voters = db.getPollVoters(poll.id);
  const isOwner = req.session.myPolls && req.session.myPolls.includes(poll.id);

  res.render('results', {
    title: `Results: ${poll.title} — GVote`,
    poll, results, totalVotes, voters, isOwner,
  });
});

// 404
app.use((req, res) => {
  res.status(404).render('error', { title: '404 - Not Found', message: 'Page not found.', code: 404 });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('SERVER ERROR:', err.stack);
  res.status(500).render('error', { title: '500 - Server Error', message: 'Something went wrong.', code: 500 });
});

app.listen(PORT, () => {
  console.log(`\n🗳️  GVote is running at http://localhost:${PORT}`);
  console.log(`📊 Create a vote: http://localhost:${PORT}/create`);
  console.log(`🔍 Explore votes: http://localhost:${PORT}/explore`);
  console.log(`📁 Dashboard:     http://localhost:${PORT}/dashboard\n`);
});
