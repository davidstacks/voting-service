const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

let db;

function getDb() {
  if (!db) {
    const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'voting.db');
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  }
  return db;
}

const CATEGORIES = [
  { id: 'general', label: 'General', icon: 'fa-globe' },
  { id: 'school', label: 'School', icon: 'fa-graduation-cap' },
  { id: 'work', label: 'Work', icon: 'fa-briefcase' },
  { id: 'fun', label: 'Fun & Games', icon: 'fa-gamepad' },
  { id: 'sports', label: 'Sports', icon: 'fa-futbol' },
  { id: 'food', label: 'Food & Drink', icon: 'fa-utensils' },
  { id: 'tech', label: 'Technology', icon: 'fa-laptop-code' },
  { id: 'events', label: 'Events', icon: 'fa-calendar-days' },
  { id: 'feedback', label: 'Feedback', icon: 'fa-comments' },
  { id: 'other', label: 'Other', icon: 'fa-ellipsis' },
];

const POLL_TYPES = [
  { id: 'choice', label: 'Multiple Choice', icon: 'fa-list-check', desc: 'Pick one or more options' },
  { id: 'yesno', label: 'Yes / No', icon: 'fa-thumbs-up', desc: 'Simple yes or no question' },
  { id: 'rating', label: 'Rating (1-5)', icon: 'fa-star', desc: 'Rate with 1 to 5 stars' },
];

function initialize() {
  const d = getDb();

  d.exec(`
    CREATE TABLE IF NOT EXISTS polls (
      id TEXT PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      admin_password_hash TEXT,
      category TEXT DEFAULT 'general',
      poll_type TEXT DEFAULT 'choice',
      allow_multiple INTEGER DEFAULT 0,
      show_results_before_end INTEGER DEFAULT 1,
      max_votes_per_person INTEGER DEFAULT 1,
      end_date TEXT,
      is_closed INTEGER DEFAULT 0,
      is_public INTEGER DEFAULT 1,
      require_name INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      total_votes INTEGER DEFAULT 0,
      session_owner TEXT
    );

    CREATE TABLE IF NOT EXISTS options (
      id TEXT PRIMARY KEY,
      poll_id TEXT NOT NULL,
      label TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      vote_count INTEGER DEFAULT 0,
      FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS votes (
      id TEXT PRIMARY KEY,
      poll_id TEXT NOT NULL,
      option_id TEXT NOT NULL,
      voter_name TEXT,
      device_fingerprint TEXT,
      session_id TEXT,
      user_agent TEXT,
      ip_address TEXT,
      cast_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (poll_id) REFERENCES polls(id) ON DELETE CASCADE,
      FOREIGN KEY (option_id) REFERENCES options(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_votes_poll ON votes(poll_id);
    CREATE INDEX IF NOT EXISTS idx_votes_fp ON votes(poll_id, device_fingerprint);
    CREATE INDEX IF NOT EXISTS idx_votes_session ON votes(poll_id, session_id);
    CREATE INDEX IF NOT EXISTS idx_polls_slug ON polls(slug);
    CREATE INDEX IF NOT EXISTS idx_options_poll ON options(poll_id);
    CREATE INDEX IF NOT EXISTS idx_polls_category ON polls(category);
    CREATE INDEX IF NOT EXISTS idx_polls_type ON polls(poll_type);
    CREATE INDEX IF NOT EXISTS idx_polls_public ON polls(is_public, is_closed);
    CREATE INDEX IF NOT EXISTS idx_polls_session_owner ON polls(session_owner);
  `);

  // Migrations for existing DBs
  const cols = d.prepare("PRAGMA table_info(polls)").all().map(c => c.name);
  if (!cols.includes('category'))         d.exec("ALTER TABLE polls ADD COLUMN category TEXT DEFAULT 'general'");
  if (!cols.includes('poll_type'))        d.exec("ALTER TABLE polls ADD COLUMN poll_type TEXT DEFAULT 'choice'");
  if (!cols.includes('is_public'))        d.exec("ALTER TABLE polls ADD COLUMN is_public INTEGER DEFAULT 1");
  if (!cols.includes('session_owner'))    d.exec("ALTER TABLE polls ADD COLUMN session_owner TEXT");
  if (!cols.includes('access_code_hash')) d.exec("ALTER TABLE polls ADD COLUMN access_code_hash TEXT");

  const vcols = d.prepare("PRAGMA table_info(votes)").all().map(c => c.name);
  if (!vcols.includes('ip_address')) d.exec("ALTER TABLE votes ADD COLUMN ip_address TEXT");

  console.log('Database initialized');
}

// --- Slug generation ---
function generateSlug(length = 8) {
  const chars = 'abcdefghijkmnpqrstuvwxyz23456789';
  let slug = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    slug += chars[bytes[i] % chars.length];
  }
  return slug;
}

function generateUniqueSlug() {
  const d = getDb();
  let slug, attempts = 0;
  do {
    slug = generateSlug(attempts < 5 ? 8 : 12);
    attempts++;
  } while (d.prepare('SELECT id FROM polls WHERE slug = ?').get(slug));
  return slug;
}

// --- Poll CRUD ---
function createPoll({ title, description, options, adminPassword, allowMultiple, showResults, maxVotes, endDate, requireName, category, pollType, isPublic, sessionOwner, accessCode }) {
  const d = getDb();
  const id = crypto.randomUUID();
  const slug = generateUniqueSlug();

  let adminPasswordHash = null;
  if (adminPassword && adminPassword.trim()) {
    adminPasswordHash = crypto.createHash('sha256').update(adminPassword.trim()).digest('hex');
  }

  let accessCodeHash = null;
  if (accessCode && accessCode.trim()) {
    accessCodeHash = crypto.createHash('sha256').update(accessCode.trim().toLowerCase()).digest('hex');
  }

  // For yes/no type, override options
  if (pollType === 'yesno') {
    options = ['Yes', 'No'];
  }
  // For rating type, override options
  if (pollType === 'rating') {
    options = ['1 Star', '2 Stars', '3 Stars', '4 Stars', '5 Stars'];
  }

  const insertPoll = d.transaction(() => {
    d.prepare(`
      INSERT INTO polls (id, slug, title, description, admin_password_hash, allow_multiple, show_results_before_end, max_votes_per_person, end_date, require_name, category, poll_type, is_public, session_owner, access_code_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, slug, title, description || null, adminPasswordHash, allowMultiple ? 1 : 0, showResults !== false ? 1 : 0, maxVotes || 1, endDate || null, requireName ? 1 : 0, category || 'general', pollType || 'choice', isPublic !== false ? 1 : 0, sessionOwner || null, accessCodeHash);

    const ins = d.prepare('INSERT INTO options (id, poll_id, label, sort_order) VALUES (?, ?, ?, ?)');
    options.forEach((label, i) => {
      ins.run(crypto.randomUUID(), id, label.trim(), i);
    });

    return { id, slug };
  });

  return insertPoll();
}

function duplicatePoll(pollId, sessionOwner) {
  const d = getDb();
  const orig = d.prepare('SELECT * FROM polls WHERE id = ?').get(pollId);
  if (!orig) throw new Error('Poll not found.');
  const origOptions = d.prepare('SELECT label FROM options WHERE poll_id = ? ORDER BY sort_order ASC').all(pollId);
  return createPoll({
    title: `${orig.title} (Copy)`,
    description: orig.description,
    options: origOptions.map(o => o.label),
    adminPassword: null,
    allowMultiple: !!orig.allow_multiple,
    showResults: !!orig.show_results_before_end,
    maxVotes: orig.max_votes_per_person,
    endDate: null,
    requireName: !!orig.require_name,
    category: orig.category,
    pollType: orig.poll_type,
    isPublic: !!orig.is_public,
    sessionOwner,
  });
}

function getPollBySlug(slug) {
  return getDb().prepare('SELECT * FROM polls WHERE slug = ?').get(slug);
}

function getPollById(id) {
  return getDb().prepare('SELECT * FROM polls WHERE id = ?').get(id);
}

function getOptionsByPoll(pollId) {
  return getDb().prepare('SELECT * FROM options WHERE poll_id = ? ORDER BY sort_order ASC').all(pollId);
}

function getPollResults(pollId) {
  return getDb().prepare(`
    SELECT o.id, o.label, o.vote_count, o.sort_order
    FROM options o WHERE o.poll_id = ?
    ORDER BY o.vote_count DESC
  `).all(pollId);
}

function closePoll(pollId) {
  getDb().prepare("UPDATE polls SET is_closed = 1, updated_at = datetime('now') WHERE id = ?").run(pollId);
}

function reopenPoll(pollId) {
  getDb().prepare("UPDATE polls SET is_closed = 0, updated_at = datetime('now') WHERE id = ?").run(pollId);
}

function deletePoll(pollId) {
  getDb().prepare('DELETE FROM polls WHERE id = ?').run(pollId);
}

function verifyAdminPassword(poll, password) {
  if (!poll.admin_password_hash) return true;
  const hash = crypto.createHash('sha256').update(password.trim()).digest('hex');
  return hash === poll.admin_password_hash;
}

function verifyAccessCode(poll, code) {
  if (!poll.access_code_hash) return true; // no code required
  const hash = crypto.createHash('sha256').update((code || '').trim().toLowerCase()).digest('hex');
  return hash === poll.access_code_hash;
}

// --- Voting ---
function castVote({ pollId, optionIds, voterName, deviceFingerprint, sessionId, userAgent, ipAddress }) {
  const d = getDb();
  const poll = d.prepare('SELECT * FROM polls WHERE id = ?').get(pollId);

  if (!poll) throw new Error('Poll not found.');
  if (poll.is_closed) throw new Error('This poll has been closed.');
  if (poll.end_date && new Date(poll.end_date) < new Date()) throw new Error('This poll has ended.');

  // Duplicate check: fingerprint
  if (deviceFingerprint) {
    const fpVotes = d.prepare('SELECT COUNT(*) as cnt FROM votes WHERE poll_id = ? AND device_fingerprint = ?').get(pollId, deviceFingerprint);
    if (fpVotes.cnt >= (poll.max_votes_per_person || 1)) {
      throw new Error('You have already voted in this poll.');
    }
  }

  // Duplicate check: session
  if (sessionId) {
    const sv = d.prepare('SELECT COUNT(*) as cnt FROM votes WHERE poll_id = ? AND session_id = ?').get(pollId, sessionId);
    if (sv.cnt >= (poll.max_votes_per_person || 1)) {
      throw new Error('You have already voted in this poll.');
    }
  }

  if (!Array.isArray(optionIds)) optionIds = [optionIds];
  if (!poll.allow_multiple && optionIds.length > 1) {
    throw new Error('This poll only allows one selection.');
  }

  const validOptions = d.prepare('SELECT id FROM options WHERE poll_id = ?').all(pollId).map(o => o.id);
  for (const oid of optionIds) {
    if (!validOptions.includes(oid)) throw new Error('Invalid option selected.');
  }

  const doVote = d.transaction(() => {
    // Double-check inside transaction
    if (deviceFingerprint) {
      const fpCheck = d.prepare('SELECT COUNT(*) as cnt FROM votes WHERE poll_id = ? AND device_fingerprint = ?').get(pollId, deviceFingerprint);
      if (fpCheck.cnt >= (poll.max_votes_per_person || 1)) {
        throw new Error('You have already voted in this poll.');
      }
    }

    const insVote = d.prepare('INSERT INTO votes (id, poll_id, option_id, voter_name, device_fingerprint, session_id, user_agent, ip_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const updCount = d.prepare('UPDATE options SET vote_count = vote_count + 1 WHERE id = ?');

    for (const oid of optionIds) {
      insVote.run(crypto.randomUUID(), pollId, oid, voterName || null, deviceFingerprint || null, sessionId || null, userAgent || null, ipAddress || null);
      updCount.run(oid);
    }

    d.prepare("UPDATE polls SET total_votes = total_votes + ?, updated_at = datetime('now') WHERE id = ?").run(optionIds.length, pollId);
  });

  doVote();
  return { success: true };
}

function hasVoted(pollId, deviceFingerprint, sessionId) {
  const d = getDb();
  if (deviceFingerprint) {
    const fp = d.prepare('SELECT COUNT(*) as cnt FROM votes WHERE poll_id = ? AND device_fingerprint = ?').get(pollId, deviceFingerprint);
    if (fp.cnt > 0) return true;
  }
  if (sessionId) {
    const s = d.prepare('SELECT COUNT(*) as cnt FROM votes WHERE poll_id = ? AND session_id = ?').get(pollId, sessionId);
    if (s.cnt > 0) return true;
  }
  return false;
}

function getRecentPolls(limit = 20) {
  return getDb().prepare("SELECT slug, title, total_votes, is_closed, created_at, end_date, category, poll_type FROM polls WHERE is_public = 1 ORDER BY created_at DESC LIMIT ?").all(limit);
}

function getMyPolls(sessionId) {
  if (!sessionId) return [];
  return getDb().prepare("SELECT slug, title, total_votes, is_closed, created_at, end_date, category, poll_type FROM polls WHERE session_owner = ? ORDER BY created_at DESC").all(sessionId);
}

function getMyPollsByIds(pollIds) {
  if (!pollIds || pollIds.length === 0) return [];
  const placeholders = pollIds.map(() => '?').join(',');
  return getDb().prepare(`SELECT slug, title, total_votes, is_closed, created_at, end_date, category, poll_type FROM polls WHERE id IN (${placeholders}) ORDER BY created_at DESC`).all(...pollIds);
}

function searchPolls({ query, category, sort, page = 1, limit = 12 }) {
  const d = getDb();
  let sql = "SELECT slug, title, description, total_votes, is_closed, created_at, end_date, category, poll_type FROM polls WHERE is_public = 1";
  const params = [];

  if (query && query.trim()) {
    sql += " AND (title LIKE ? OR description LIKE ?)";
    const q = `%${query.trim()}%`;
    params.push(q, q);
  }

  if (category && category !== 'all') {
    sql += " AND category = ?";
    params.push(category);
  }

  // Note: active filter is applied in countBase/dataSql below

  let orderBy = " ORDER BY created_at DESC";
  if (sort === 'popular') orderBy = " ORDER BY total_votes DESC";
  if (sort === 'active') orderBy = " ORDER BY updated_at DESC";
  if (sort === 'ending') orderBy = " ORDER BY end_date ASC";

  // Count total
  let countSql = sql.replace(/SELECT .+? FROM/, 'SELECT COUNT(*) as total FROM');
  // For 'active' sort with the extra condition, rebuild properly
  let countBase = "SELECT COUNT(*) as total FROM polls WHERE is_public = 1";
  const countParams = [];
  if (query && query.trim()) {
    countBase += " AND (title LIKE ? OR description LIKE ?)";
    const q = `%${query.trim()}%`;
    countParams.push(q, q);
  }
  if (category && category !== 'all') {
    countBase += " AND category = ?";
    countParams.push(category);
  }
  if (sort === 'active') {
    countBase += " AND is_closed = 0 AND (end_date IS NULL OR end_date > datetime('now'))";
  }

  const total = d.prepare(countBase).get(...countParams).total;

  // Use same conditions as count for actual query
  let dataSql = countBase.replace('SELECT COUNT(*) as total FROM', 'SELECT slug, title, description, total_votes, is_closed, created_at, end_date, category, poll_type FROM');
  dataSql += orderBy;
  dataSql += " LIMIT ? OFFSET ?";
  const offset = (page - 1) * limit;

  const polls = d.prepare(dataSql).all(...countParams, limit, offset);
  return { polls, total, page, totalPages: Math.ceil(total / limit) };
}

function getPollVoters(pollId) {
  return getDb().prepare(`
    SELECT v.voter_name, v.cast_at, o.label as option_label,
           SUBSTR(v.device_fingerprint, 1, 8) as device_short
    FROM votes v
    JOIN options o ON o.id = v.option_id
    WHERE v.poll_id = ?
    ORDER BY v.cast_at DESC
  `).all(pollId);
}

function getPlatformStats() {
  const d = getDb();
  const totalPolls = d.prepare('SELECT COUNT(*) as cnt FROM polls').get().cnt;
  const totalVotes = d.prepare('SELECT COALESCE(SUM(total_votes), 0) as cnt FROM polls').get().cnt;
  const activePolls = d.prepare("SELECT COUNT(*) as cnt FROM polls WHERE is_closed = 0 AND (end_date IS NULL OR end_date > datetime('now'))").get().cnt;
  const todayVotes = d.prepare("SELECT COUNT(*) as cnt FROM votes WHERE cast_at >= date('now')").get().cnt;
  return { totalPolls, totalVotes, activePolls, todayVotes };
}

function getPopularPolls(limit = 6) {
  return getDb().prepare("SELECT slug, title, total_votes, is_closed, created_at, end_date, category, poll_type FROM polls WHERE is_public = 1 AND is_closed = 0 AND (end_date IS NULL OR end_date > datetime('now')) ORDER BY total_votes DESC LIMIT ?").all(limit);
}

function getEndingSoonPolls(limit = 6) {
  return getDb().prepare("SELECT slug, title, total_votes, is_closed, created_at, end_date, category, poll_type FROM polls WHERE is_public = 1 AND is_closed = 0 AND end_date IS NOT NULL AND end_date > datetime('now') ORDER BY end_date ASC LIMIT ?").all(limit);
}

module.exports = {
  initialize, getDb, createPoll, duplicatePoll, getPollBySlug, getPollById,
  getOptionsByPoll, getPollResults, closePoll, reopenPoll,
  deletePoll, verifyAdminPassword, verifyAccessCode, castVote, hasVoted,
  getRecentPolls, getMyPolls, getMyPollsByIds, searchPolls,
  getPollVoters, getPlatformStats, getPopularPolls, getEndingSoonPolls,
  CATEGORIES, POLL_TYPES,
};
