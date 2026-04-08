const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

const DB_PATH = path.join(__dirname, '..', 'voting.db');
const SALT_ROUNDS = 12;

let db;

function getDb() {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

function initialize() {
  const db = getDb();

  db.exec(`
    -- Users table
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      student_id TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'voter' CHECK(role IN ('voter', 'admin')),
      is_verified INTEGER NOT NULL DEFAULT 0,
      is_locked INTEGER NOT NULL DEFAULT 0,
      failed_login_attempts INTEGER NOT NULL DEFAULT 0,
      last_login_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- Elections table
    CREATE TABLE IF NOT EXISTS elections (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'active', 'paused', 'closed', 'archived')),
      created_by TEXT NOT NULL,
      max_votes_per_user INTEGER NOT NULL DEFAULT 1,
      is_anonymous INTEGER NOT NULL DEFAULT 1,
      requires_verification INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );

    -- Candidates table
    CREATE TABLE IF NOT EXISTS candidates (
      id TEXT PRIMARY KEY,
      election_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      platform TEXT,
      position TEXT,
      display_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (election_id) REFERENCES elections(id) ON DELETE CASCADE
    );

    -- Votes table (encrypted ballot)
    CREATE TABLE IF NOT EXISTS votes (
      id TEXT PRIMARY KEY,
      election_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      candidate_id TEXT NOT NULL,
      vote_hash TEXT NOT NULL,
      receipt_code TEXT UNIQUE NOT NULL,
      device_fingerprint TEXT,
      user_agent TEXT,
      cast_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (election_id) REFERENCES elections(id),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (candidate_id) REFERENCES candidates(id),
      UNIQUE(election_id, user_id)
    );

    -- Audit log table
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      action TEXT NOT NULL,
      resource_type TEXT,
      resource_id TEXT,
      details TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- Sessions tracking for security
    CREATE TABLE IF NOT EXISTS active_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    -- Vote attempt tracking (anti-spam / cooldown)
    CREATE TABLE IF NOT EXISTS vote_attempts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      election_id TEXT NOT NULL,
      device_fingerprint TEXT,
      attempted_at TEXT NOT NULL DEFAULT (datetime('now')),
      was_blocked INTEGER NOT NULL DEFAULT 0,
      block_reason TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (election_id) REFERENCES elections(id)
    );

    -- Device fingerprint tracking (links devices to users)
    CREATE TABLE IF NOT EXISTS device_fingerprints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      first_seen TEXT NOT NULL DEFAULT (datetime('now')),
      last_seen TEXT NOT NULL DEFAULT (datetime('now')),
      times_seen INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (user_id) REFERENCES users(id),
      UNIQUE(user_id, fingerprint)
    );

    -- Create indexes for performance
    CREATE INDEX IF NOT EXISTS idx_votes_election ON votes(election_id);
    CREATE INDEX IF NOT EXISTS idx_votes_user ON votes(user_id);
    CREATE INDEX IF NOT EXISTS idx_votes_election_user ON votes(election_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_votes_fingerprint ON votes(device_fingerprint);
    CREATE INDEX IF NOT EXISTS idx_candidates_election ON candidates(election_id);
    CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id);
    CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action);
    CREATE INDEX IF NOT EXISTS idx_elections_status ON elections(status);
    CREATE INDEX IF NOT EXISTS idx_vote_attempts_user ON vote_attempts(user_id, election_id);
    CREATE INDEX IF NOT EXISTS idx_vote_attempts_fp ON vote_attempts(device_fingerprint);
    CREATE INDEX IF NOT EXISTS idx_device_fp ON device_fingerprints(fingerprint);
  `);

  // Create default admin if none exists
  const adminExists = db.prepare('SELECT COUNT(*) as count FROM users WHERE role = ?').get('admin');
  if (adminExists.count === 0) {
    const adminId = crypto.randomUUID();
    const passwordHash = bcrypt.hashSync('Admin@2024!Secure', SALT_ROUNDS);
    db.prepare(`
      INSERT INTO users (id, student_id, email, username, password_hash, full_name, role, is_verified)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(adminId, 'ADMIN001', 'admin@school.edu', 'admin', passwordHash, 'System Administrator', 'admin', 1);
    console.log('Default admin created - Username: admin / Password: Admin@2024!Secure');
  }
}

// --- User functions ---
function createUser({ studentId, email, username, password, fullName }) {
  const db = getDb();
  const id = crypto.randomUUID();
  const passwordHash = bcrypt.hashSync(password, SALT_ROUNDS);
  db.prepare(`
    INSERT INTO users (id, student_id, email, username, password_hash, full_name, is_verified)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `).run(id, studentId, email, username, passwordHash, fullName);
  return id;
}

function getUserByUsername(username) {
  return getDb().prepare('SELECT * FROM users WHERE username = ?').get(username);
}

function getUserById(id) {
  return getDb().prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function getAllVoters() {
  return getDb().prepare('SELECT id, student_id, email, username, full_name, is_verified, is_locked, last_login_at, created_at FROM users WHERE role = ?').all('voter');
}

function verifyPassword(plaintext, hash) {
  return bcrypt.compareSync(plaintext, hash);
}

function updateLoginAttempts(userId, attempts) {
  const isLocked = attempts >= 5 ? 1 : 0;
  getDb().prepare("UPDATE users SET failed_login_attempts = ?, is_locked = ?, updated_at = datetime('now') WHERE id = ?")
    .run(attempts, isLocked, userId);
}

function resetLoginAttempts(userId) {
  getDb().prepare("UPDATE users SET failed_login_attempts = 0, is_locked = 0, last_login_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
    .run(userId);
}

function toggleUserLock(userId) {
  const user = getUserById(userId);
  const newLocked = user.is_locked ? 0 : 1;
  getDb().prepare("UPDATE users SET is_locked = ?, failed_login_attempts = 0, updated_at = datetime('now') WHERE id = ?")
    .run(newLocked, userId);
}

function toggleUserVerification(userId) {
  const user = getUserById(userId);
  const newVerified = user.is_verified ? 0 : 1;
  getDb().prepare("UPDATE users SET is_verified = ?, updated_at = datetime('now') WHERE id = ?")
    .run(newVerified, userId);
}

// --- Election functions ---
function createElection({ title, description, startDate, endDate, createdBy, maxVotes, isAnonymous }) {
  const db = getDb();
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO elections (id, title, description, start_date, end_date, created_by, max_votes_per_user, is_anonymous)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, title, description, startDate, endDate, createdBy, maxVotes || 1, isAnonymous ? 1 : 0);
  return id;
}

function getElectionById(id) {
  return getDb().prepare('SELECT * FROM elections WHERE id = ?').get(id);
}

function getAllElections() {
  return getDb().prepare('SELECT * FROM elections ORDER BY created_at DESC').all();
}

function getActiveElections() {
  return getDb().prepare(`
    SELECT * FROM elections 
    WHERE status = 'active' 
    AND datetime(start_date) <= datetime('now') 
    AND datetime(end_date) >= datetime('now')
    ORDER BY end_date ASC
  `).all();
}

function updateElectionStatus(id, status) {
  getDb().prepare("UPDATE elections SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
}

function updateElection(id, { title, description, startDate, endDate, maxVotes, isAnonymous }) {
  getDb().prepare(`
    UPDATE elections SET title = ?, description = ?, start_date = ?, end_date = ?, 
    max_votes_per_user = ?, is_anonymous = ?, updated_at = datetime('now') WHERE id = ?
  `).run(title, description, startDate, endDate, maxVotes || 1, isAnonymous ? 1 : 0, id);
}

function deleteElection(id) {
  getDb().prepare('DELETE FROM elections WHERE id = ?').run(id);
}

// --- Candidate functions ---
function addCandidate({ electionId, name, description, platform, position, displayOrder }) {
  const db = getDb();
  const id = crypto.randomUUID();
  db.prepare(`
    INSERT INTO candidates (id, election_id, name, description, platform, position, display_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, electionId, name, description || '', platform || '', position || '', displayOrder || 0);
  return id;
}

function getCandidatesByElection(electionId) {
  return getDb().prepare('SELECT * FROM candidates WHERE election_id = ? ORDER BY display_order ASC').all(electionId);
}

function deleteCandidate(id) {
  getDb().prepare('DELETE FROM candidates WHERE id = ?').run(id);
}

// --- Vote functions ---
function castVote({ electionId, userId, candidateId, deviceFingerprint, userAgent }) {
  const db = getDb();

  // PROTECTION 1: Database UNIQUE constraint — user already voted
  const existingVote = db.prepare('SELECT id FROM votes WHERE election_id = ? AND user_id = ?').get(electionId, userId);
  if (existingVote) {
    logVoteAttempt({ userId, electionId, deviceFingerprint, blocked: true, reason: 'DUPLICATE_VOTE' });
    throw new Error('You have already voted in this election. Each person can only vote ONCE.');
  }

  // PROTECTION 2: Verify candidate belongs to this election
  const validCandidate = db.prepare('SELECT id FROM candidates WHERE id = ? AND election_id = ?').get(candidateId, electionId);
  if (!validCandidate) {
    logVoteAttempt({ userId, electionId, deviceFingerprint, blocked: true, reason: 'INVALID_CANDIDATE' });
    throw new Error('Invalid candidate selection.');
  }

  // PROTECTION 3: Cooldown — block rapid-fire vote attempts (10-second window)
  const recentAttempt = db.prepare(`
    SELECT COUNT(*) as cnt FROM vote_attempts 
    WHERE user_id = ? AND datetime(attempted_at) > datetime('now', '-10 seconds')
  `).get(userId);
  if (recentAttempt.cnt >= 3) {
    logVoteAttempt({ userId, electionId, deviceFingerprint, blocked: true, reason: 'COOLDOWN_SPAM' });
    throw new Error('Too many vote attempts. Please wait a few seconds and try again.');
  }

  // PROTECTION 4: Device fingerprint — same device already voted in this election under DIFFERENT account (account sharing / multi-account abuse)
  if (deviceFingerprint) {
    const fpVote = db.prepare(`
      SELECT v.id, u.username FROM votes v
      JOIN users u ON u.id = v.user_id
      WHERE v.election_id = ? AND v.device_fingerprint = ? AND v.user_id != ?
    `).get(electionId, deviceFingerprint, userId);
    if (fpVote) {
      logVoteAttempt({ userId, electionId, deviceFingerprint, blocked: true, reason: 'DEVICE_ALREADY_VOTED' });
      throw new Error('This device has already been used to vote in this election. One device per voter.');
    }
  }

  // PROTECTION 5: Verify election is still active right at vote time
  const election = db.prepare("SELECT status, start_date, end_date FROM elections WHERE id = ? AND status = 'active'").get(electionId);
  if (!election) {
    logVoteAttempt({ userId, electionId, deviceFingerprint, blocked: true, reason: 'ELECTION_NOT_ACTIVE' });
    throw new Error('This election is not accepting votes.');
  }

  // Log the successful attempt
  logVoteAttempt({ userId, electionId, deviceFingerprint, blocked: false, reason: null });

  // Track device fingerprint for this user
  if (deviceFingerprint) {
    trackDeviceFingerprint(userId, deviceFingerprint);
  }

  // Cast the vote inside a transaction for atomicity
  const id = crypto.randomUUID();
  const receiptCode = crypto.randomBytes(16).toString('hex').toUpperCase();
  const voteData = `${electionId}:${userId}:${candidateId}:${Date.now()}:${crypto.randomBytes(8).toString('hex')}`;
  const voteHash = crypto.createHash('sha256').update(voteData).digest('hex');

  const insertVote = db.transaction(() => {
    // Double-check inside transaction (race condition protection)
    const doubleCheck = db.prepare('SELECT id FROM votes WHERE election_id = ? AND user_id = ?').get(electionId, userId);
    if (doubleCheck) {
      throw new Error('You have already voted in this election. Each person can only vote ONCE.');
    }

    db.prepare(`
      INSERT INTO votes (id, election_id, user_id, candidate_id, vote_hash, receipt_code, device_fingerprint, user_agent)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, electionId, userId, candidateId, voteHash, receiptCode, deviceFingerprint || null, userAgent);

    return { receiptCode, voteHash };
  });

  return insertVote();
}

function trackDeviceFingerprint(userId, fingerprint) {
  try {
    const existing = getDb().prepare('SELECT id, times_seen FROM device_fingerprints WHERE user_id = ? AND fingerprint = ?').get(userId, fingerprint);
    if (existing) {
      getDb().prepare("UPDATE device_fingerprints SET last_seen = datetime('now'), times_seen = times_seen + 1 WHERE id = ?").run(existing.id);
    } else {
      getDb().prepare('INSERT INTO device_fingerprints (user_id, fingerprint) VALUES (?, ?)').run(userId, fingerprint);
    }
  } catch (_) { /* don't let tracking break voting */ }
}

function getDevicesByUser(userId) {
  return getDb().prepare('SELECT * FROM device_fingerprints WHERE user_id = ? ORDER BY last_seen DESC').all(userId);
}

function getUsersByDevice(fingerprint) {
  return getDb().prepare(`
    SELECT df.*, u.username, u.full_name, u.student_id 
    FROM device_fingerprints df
    JOIN users u ON u.id = df.user_id
    WHERE df.fingerprint = ?
    ORDER BY df.last_seen DESC
  `).all(fingerprint);
}

function logVoteAttempt({ userId, electionId, deviceFingerprint, blocked, reason }) {
  try {
    getDb().prepare(`
      INSERT INTO vote_attempts (user_id, election_id, device_fingerprint, was_blocked, block_reason)
      VALUES (?, ?, ?, ?, ?)
    `).run(userId, electionId, deviceFingerprint || null, blocked ? 1 : 0, reason);
  } catch (_) { /* don't let logging failure break voting */ }
}

function getVoteAttemptsByUser(userId, electionId) {
  return getDb().prepare(`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN was_blocked = 1 THEN 1 ELSE 0 END) as blocked
    FROM vote_attempts WHERE user_id = ? AND election_id = ?
  `).get(userId, electionId);
}

function getSpamReport() {
  return getDb().prepare(`
    SELECT va.device_fingerprint, COUNT(*) as attempts, 
           SUM(CASE WHEN va.was_blocked = 1 THEN 1 ELSE 0 END) as blocked_count,
           u.username, u.full_name, va.block_reason
    FROM vote_attempts va
    JOIN users u ON u.id = va.user_id
    WHERE va.was_blocked = 1
    GROUP BY va.user_id, va.device_fingerprint
    ORDER BY blocked_count DESC
    LIMIT 50
  `).all();
}

function getSharedDeviceReport() {
  return getDb().prepare(`
    SELECT df.fingerprint, COUNT(DISTINCT df.user_id) as user_count,
           GROUP_CONCAT(DISTINCT u.username) as usernames
    FROM device_fingerprints df
    JOIN users u ON u.id = df.user_id
    GROUP BY df.fingerprint
    HAVING user_count > 1
    ORDER BY user_count DESC
    LIMIT 50
  `).all();
}

function hasUserVoted(electionId, userId) {
  const vote = getDb().prepare('SELECT id FROM votes WHERE election_id = ? AND user_id = ?').get(electionId, userId);
  return !!vote;
}

function getVoteReceipt(receiptCode) {
  return getDb().prepare('SELECT * FROM votes WHERE receipt_code = ?').get(receiptCode);
}

function getElectionResults(electionId) {
  return getDb().prepare(`
    SELECT c.id, c.name, c.position, COUNT(v.id) as vote_count
    FROM candidates c
    LEFT JOIN votes v ON v.candidate_id = c.id
    WHERE c.election_id = ?
    GROUP BY c.id
    ORDER BY vote_count DESC
  `).all(electionId);
}

function getElectionVoteCount(electionId) {
  return getDb().prepare('SELECT COUNT(*) as count FROM votes WHERE election_id = ?').get(electionId).count;
}

function getTotalVoterCount() {
  return getDb().prepare('SELECT COUNT(*) as count FROM users WHERE role = ?').get('voter').count;
}

function getElectionVoterTurnout(electionId) {
  const totalVoters = getTotalVoterCount();
  const votesCast = getElectionVoteCount(electionId);
  return totalVoters > 0 ? ((votesCast / totalVoters) * 100).toFixed(1) : 0;
}

// --- Stats functions ---
function getOverallStats() {
  const db = getDb();
  return {
    totalVoters: db.prepare('SELECT COUNT(*) as c FROM users WHERE role = ?').get('voter').c,
    totalElections: db.prepare('SELECT COUNT(*) as c FROM elections').get().c,
    activeElections: db.prepare("SELECT COUNT(*) as c FROM elections WHERE status = 'active'").get().c,
    totalVotesCast: db.prepare('SELECT COUNT(*) as c FROM votes').get().c,
    verifiedVoters: db.prepare('SELECT COUNT(*) as c FROM users WHERE role = ? AND is_verified = 1').get('voter').c,
    lockedAccounts: db.prepare('SELECT COUNT(*) as c FROM users WHERE is_locked = 1').get().c,
  };
}

function getRecentActivity(limit = 20) {
  return getDb().prepare(`
    SELECT al.*, u.username, u.full_name
    FROM audit_log al
    LEFT JOIN users u ON u.id = al.user_id
    ORDER BY al.created_at DESC
    LIMIT ?
  `).all(limit);
}

function getVotingTimeline(electionId) {
  return getDb().prepare(`
    SELECT strftime('%Y-%m-%d %H:00', cast_at) as hour, COUNT(*) as count
    FROM votes
    WHERE election_id = ?
    GROUP BY hour
    ORDER BY hour ASC
  `).all(electionId);
}

// --- Audit log ---
function logAudit({ userId, action, resourceType, resourceId, details, ipAddress, userAgent }) {
  getDb().prepare(`
    INSERT INTO audit_log (user_id, action, resource_type, resource_id, details, ip_address, user_agent)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(userId || null, action, resourceType || null, resourceId || null, details || null, ipAddress || null, userAgent || null);
}

module.exports = {
  initialize,
  getDb,
  createUser,
  getUserByUsername,
  getUserById,
  getAllVoters,
  verifyPassword,
  updateLoginAttempts,
  resetLoginAttempts,
  toggleUserLock,
  toggleUserVerification,
  createElection,
  getElectionById,
  getAllElections,
  getActiveElections,
  updateElectionStatus,
  updateElection,
  deleteElection,
  addCandidate,
  getCandidatesByElection,
  deleteCandidate,
  castVote,
  hasUserVoted,
  getVoteReceipt,
  getElectionResults,
  getElectionVoteCount,
  getTotalVoterCount,
  getElectionVoterTurnout,
  getOverallStats,
  getRecentActivity,
  getVotingTimeline,
  logAudit,
  logVoteAttempt,
  getVoteAttemptsByUser,
  getSpamReport,
  getSharedDeviceReport,
  trackDeviceFingerprint,
  getDevicesByUser,
  getUsersByDevice,
};
