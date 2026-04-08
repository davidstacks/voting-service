const express = require('express');
const router = express.Router();
const db = require('../db/database');
const { isAuthenticated, isAdmin } = require('../middleware/auth');
const { body, validationResult } = require('express-validator');

// All admin routes require auth + admin role
router.use(isAuthenticated, isAdmin);

// Admin dashboard
router.get('/', (req, res) => {
  const stats = db.getOverallStats();
  const elections = db.getAllElections();
  const recentActivity = db.getRecentActivity(15);

  const enrichedElections = elections.map(e => ({
    ...e,
    voteCount: db.getElectionVoteCount(e.id),
    candidateCount: db.getCandidatesByElection(e.id).length,
    turnout: db.getElectionVoterTurnout(e.id),
  }));

  res.render('admin/dashboard', {
    title: 'Admin Dashboard - SecureVote',
    stats,
    elections: enrichedElections,
    recentActivity,
  });
});

// Manage voters
router.get('/voters', (req, res) => {
  const voters = db.getAllVoters();
  res.render('admin/voters', { title: 'Manage Voters - SecureVote', voters });
});

// Toggle voter lock
router.post('/voters/:id/toggle-lock', (req, res) => {
  db.toggleUserLock(req.params.id);
  db.logAudit({ userId: req.user.id, action: 'TOGGLE_LOCK', resourceType: 'user', resourceId: req.params.id, ipAddress: req.ip, userAgent: req.get('User-Agent') });
  req.session.success = 'Voter lock status updated.';
  res.redirect('/admin/voters');
});

// Toggle voter verification
router.post('/voters/:id/toggle-verify', (req, res) => {
  db.toggleUserVerification(req.params.id);
  db.logAudit({ userId: req.user.id, action: 'TOGGLE_VERIFY', resourceType: 'user', resourceId: req.params.id, ipAddress: req.ip, userAgent: req.get('User-Agent') });
  req.session.success = 'Voter verification status updated.';
  res.redirect('/admin/voters');
});

// Create election page
router.get('/elections/new', (req, res) => {
  res.render('admin/election-form', { title: 'Create Election - SecureVote', election: null });
});

// Create election handler
router.post('/elections', [
  body('title').trim().notEmpty().isLength({ max: 200 }).escape(),
  body('description').trim().notEmpty().isLength({ max: 2000 }).escape(),
  body('startDate').trim().notEmpty(),
  body('endDate').trim().notEmpty(),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.session.error = 'Please fill all fields correctly.';
    return res.redirect('/admin/elections/new');
  }

  const { title, description, startDate, endDate, maxVotes, isAnonymous } = req.body;
  const electionId = db.createElection({
    title, description, startDate, endDate,
    createdBy: req.user.id,
    maxVotes: parseInt(maxVotes) || 1,
    isAnonymous: isAnonymous === 'on',
  });

  db.logAudit({ userId: req.user.id, action: 'CREATE_ELECTION', resourceType: 'election', resourceId: electionId, ipAddress: req.ip, userAgent: req.get('User-Agent') });
  req.session.success = 'Election created successfully!';
  res.redirect(`/admin/elections/${electionId}`);
});

// View election details
router.get('/elections/:id', (req, res) => {
  const election = db.getElectionById(req.params.id);
  if (!election) {
    req.session.error = 'Election not found.';
    return res.redirect('/admin');
  }

  const candidates = db.getCandidatesByElection(election.id);
  const results = db.getElectionResults(election.id);
  const voteCount = db.getElectionVoteCount(election.id);
  const turnout = db.getElectionVoterTurnout(election.id);
  const timeline = db.getVotingTimeline(election.id);

  res.render('admin/election-detail', {
    title: `${election.title} - Admin - SecureVote`,
    election,
    candidates,
    results,
    voteCount,
    turnout,
    timeline,
  });
});

// Edit election
router.get('/elections/:id/edit', (req, res) => {
  const election = db.getElectionById(req.params.id);
  if (!election) {
    req.session.error = 'Election not found.';
    return res.redirect('/admin');
  }
  res.render('admin/election-form', { title: 'Edit Election - SecureVote', election });
});

router.post('/elections/:id/edit', [
  body('title').trim().notEmpty().isLength({ max: 200 }).escape(),
  body('description').trim().notEmpty().isLength({ max: 2000 }).escape(),
  body('startDate').trim().notEmpty(),
  body('endDate').trim().notEmpty(),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.session.error = 'Please fill all fields correctly.';
    return res.redirect(`/admin/elections/${req.params.id}/edit`);
  }

  const { title, description, startDate, endDate, maxVotes, isAnonymous } = req.body;
  db.updateElection(req.params.id, {
    title, description, startDate, endDate,
    maxVotes: parseInt(maxVotes) || 1,
    isAnonymous: isAnonymous === 'on',
  });

  db.logAudit({ userId: req.user.id, action: 'UPDATE_ELECTION', resourceType: 'election', resourceId: req.params.id, ipAddress: req.ip, userAgent: req.get('User-Agent') });
  req.session.success = 'Election updated successfully!';
  res.redirect(`/admin/elections/${req.params.id}`);
});

// Update election status
router.post('/elections/:id/status', [
  body('status').isIn(['draft', 'active', 'paused', 'closed', 'archived']),
], (req, res) => {
  db.updateElectionStatus(req.params.id, req.body.status);
  db.logAudit({ userId: req.user.id, action: 'UPDATE_STATUS', resourceType: 'election', resourceId: req.params.id, details: `Status: ${req.body.status}`, ipAddress: req.ip, userAgent: req.get('User-Agent') });
  req.session.success = `Election status changed to ${req.body.status}.`;
  res.redirect(`/admin/elections/${req.params.id}`);
});

// Delete election
router.post('/elections/:id/delete', (req, res) => {
  db.logAudit({ userId: req.user.id, action: 'DELETE_ELECTION', resourceType: 'election', resourceId: req.params.id, ipAddress: req.ip, userAgent: req.get('User-Agent') });
  db.deleteElection(req.params.id);
  req.session.success = 'Election deleted.';
  res.redirect('/admin');
});

// Add candidate
router.post('/elections/:id/candidates', [
  body('name').trim().notEmpty().isLength({ max: 100 }).escape(),
  body('description').trim().optional().isLength({ max: 500 }).escape(),
  body('platform').trim().optional().isLength({ max: 1000 }).escape(),
  body('position').trim().optional().isLength({ max: 100 }).escape(),
], (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    req.session.error = 'Invalid candidate data.';
    return res.redirect(`/admin/elections/${req.params.id}`);
  }

  const { name, description, platform, position } = req.body;
  db.addCandidate({ electionId: req.params.id, name, description, platform, position });
  db.logAudit({ userId: req.user.id, action: 'ADD_CANDIDATE', resourceType: 'election', resourceId: req.params.id, details: `Candidate: ${name}`, ipAddress: req.ip, userAgent: req.get('User-Agent') });
  req.session.success = 'Candidate added!';
  res.redirect(`/admin/elections/${req.params.id}`);
});

// Remove candidate
router.post('/elections/:id/candidates/:cid/delete', (req, res) => {
  db.deleteCandidate(req.params.cid);
  db.logAudit({ userId: req.user.id, action: 'DELETE_CANDIDATE', resourceType: 'election', resourceId: req.params.id, ipAddress: req.ip, userAgent: req.get('User-Agent') });
  req.session.success = 'Candidate removed.';
  res.redirect(`/admin/elections/${req.params.id}`);
});

// Audit log
router.get('/audit', (req, res) => {
  const logs = db.getRecentActivity(100);
  res.render('admin/audit', { title: 'Audit Log - SecureVote', logs });
});

// Spam / blocked vote attempts report
router.get('/spam-report', (req, res) => {
  const spamReport = db.getSpamReport();
  const sharedDevices = db.getSharedDeviceReport();
  res.render('admin/spam-report', { title: 'Spam Report - SecureVote', spamReport, sharedDevices });
});

// Stats API endpoint
router.get('/api/stats', (req, res) => {
  const stats = db.getOverallStats();
  res.json(stats);
});

router.get('/api/elections/:id/results', (req, res) => {
  const results = db.getElectionResults(req.params.id);
  const timeline = db.getVotingTimeline(req.params.id);
  res.json({ results, timeline });
});

module.exports = router;
