const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { isAuthenticated, isVerifiedVoter } = require('../middleware/auth');
const { voteLimiter } = require('../middleware/rateLimiter');
const { body, validationResult } = require('express-validator');

// Voter dashboard
router.get('/', isAuthenticated, (req, res) => {
  const elections = db.getActiveElections();
  const allElections = db.getAllElections();

  // Check which elections user has voted in
  const electionsWithStatus = allElections.map(e => ({
    ...e,
    hasVoted: db.hasUserVoted(e.id, req.user.id),
    voteCount: db.getElectionVoteCount(e.id),
    candidateCount: db.getCandidatesByElection(e.id).length,
    isActive: e.status === 'active' && new Date(e.start_date) <= new Date() && new Date(e.end_date) >= new Date(),
  }));

  res.render('voter/dashboard', {
    title: 'Dashboard - SecureVote',
    elections: electionsWithStatus,
    activeCount: elections.length,
  });
});

// View election details / vote page
router.get('/election/:id', isAuthenticated, isVerifiedVoter, (req, res) => {
  const election = db.getElectionById(req.params.id);
  if (!election) {
    req.session.error = 'Election not found.';
    return res.redirect('/dashboard');
  }

  const candidates = db.getCandidatesByElection(election.id);
  const hasVoted = db.hasUserVoted(election.id, req.user.id);
  const results = (election.status === 'closed' || election.status === 'archived') ? db.getElectionResults(election.id) : null;
  const voteCount = db.getElectionVoteCount(election.id);
  const turnout = db.getElectionVoterTurnout(election.id);
  const isActive = election.status === 'active' && new Date(election.start_date) <= new Date() && new Date(election.end_date) >= new Date();

  res.render('voter/election', {
    title: `${election.title} - SecureVote`,
    election,
    candidates,
    hasVoted,
    results,
    voteCount,
    turnout,
    isActive,
  });
});

// Cast vote — HARDENED: multi-layer protection against double-voting & spam
router.post('/election/:id/vote', isAuthenticated, isVerifiedVoter, voteLimiter, [
  body('candidateId').trim().notEmpty().isUUID().withMessage('Invalid candidate'),
  body('deviceFingerprint').optional().trim().escape(),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.session.error = 'Invalid vote submission. Do not tamper with the form.';
    return res.redirect(`/dashboard/election/${req.params.id}`);
  }

  // SESSION CHECK: Already voted in this election (session memory)?
  if (req.session.votedElections && req.session.votedElections.includes(req.params.id)) {
    req.session.error = 'You have already voted in this election (session confirmed).';
    return res.redirect(`/dashboard/election/${req.params.id}`);
  }

  // COOKIE CHECK: Voted cookie set for this election?
  const votedCookieName = `voted_${req.params.id}`;
  if (req.signedCookies && req.signedCookies[votedCookieName]) {
    req.session.error = 'You have already voted in this election.';
    return res.redirect(`/dashboard/election/${req.params.id}`);
  }

  // SERVER CHECK 1: Has user already voted? (fast pre-check before hitting castVote)
  if (db.hasUserVoted(req.params.id, req.user.id)) {
    req.session.error = 'You have already voted in this election. You cannot vote twice.';
    db.logAudit({
      userId: req.user.id, action: 'DUPLICATE_VOTE_ATTEMPT',
      resourceType: 'election', resourceId: req.params.id,
      details: 'Blocked at route level', ipAddress: req.ip, userAgent: req.get('User-Agent'),
    });
    return res.redirect(`/dashboard/election/${req.params.id}`);
  }

  // SERVER CHECK 2: Election actually active?
  const election = db.getElectionById(req.params.id);
  if (!election || election.status !== 'active') {
    req.session.error = 'This election is not currently accepting votes.';
    return res.redirect('/dashboard');
  }

  // SERVER CHECK 3: Within time window?
  const now = new Date();
  if (new Date(election.start_date) > now || new Date(election.end_date) < now) {
    req.session.error = 'This election is not within its voting period.';
    return res.redirect('/dashboard');
  }

  // SERVER CHECK 4: User is not locked
  if (req.user.is_locked) {
    req.session.error = 'Your account is locked. Contact an administrator.';
    return res.redirect('/dashboard');
  }

  try {
    const result = db.castVote({
      electionId: election.id,
      userId: req.user.id,
      candidateId: req.body.candidateId,
      deviceFingerprint: req.body.deviceFingerprint || null,
      userAgent: req.get('User-Agent'),
    });

    // SESSION: Remember this election was voted in
    if (!req.session.votedElections) req.session.votedElections = [];
    req.session.votedElections.push(election.id);

    // COOKIE: Set a signed HTTP-only cookie (survives session expiry, 1 year)
    res.cookie(votedCookieName, '1', {
      maxAge: 365 * 24 * 60 * 60 * 1000,
      httpOnly: true,
      signed: true,
      sameSite: 'strict',
    });

    db.logAudit({
      userId: req.user.id,
      action: 'VOTE_CAST',
      resourceType: 'election',
      resourceId: election.id,
      details: `Receipt: ${result.receiptCode}`,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });

    req.session.success = `Vote cast successfully! Your receipt code: ${result.receiptCode}. Save this for verification.`;
    res.redirect(`/dashboard/election/${req.params.id}`);
  } catch (err) {
    db.logAudit({
      userId: req.user.id,
      action: 'VOTE_BLOCKED',
      resourceType: 'election',
      resourceId: election.id,
      details: err.message,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
    });
    req.session.error = err.message;
    res.redirect(`/dashboard/election/${req.params.id}`);
  }
});

// Verify vote receipt
router.get('/verify', isAuthenticated, (req, res) => {
  res.render('voter/verify', { title: 'Verify Vote - SecureVote', receipt: null });
});

router.post('/verify', isAuthenticated, [
  body('receiptCode').trim().notEmpty().escape(),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.session.error = 'Please enter a receipt code.';
    return res.redirect('/dashboard/verify');
  }

  const receipt = db.getVoteReceipt(req.body.receiptCode);
  if (receipt) {
    const election = db.getElectionById(receipt.election_id);
    res.render('voter/verify', {
      title: 'Verify Vote - SecureVote',
      receipt: { ...receipt, electionTitle: election ? election.title : 'Unknown' },
    });
  } else {
    req.session.error = 'No vote found with that receipt code.';
    res.redirect('/dashboard/verify');
  }
});

module.exports = router;
