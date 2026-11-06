'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const PROD = process.env.NODE_ENV === 'production';
const DEMO_MODE = process.env.DEMO_MODE === 'true' && !PROD;
// Demo-only credentials. Never enable DEMO_MODE on a public or production server.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (DEMO_MODE ? '12345678' : '');
const SESSION_SECRET = process.env.SESSION_SECRET || (DEMO_MODE ? crypto.randomBytes(48).toString('hex') : '');
if ((!DEMO_MODE && ADMIN_PASSWORD.length < 14) || SESSION_SECRET.length < 32) {
  console.error('Setup required: set ADMIN_PASSWORD (14+ characters) and SESSION_SECRET (32+ characters). For a local demo only, set DEMO_MODE=true and NODE_ENV=development.');
  process.exit(1);
}
if (DEMO_MODE) console.warn('DEMO MODE: password 12345678 is enabled. Use only on localhost; do not deploy this configuration publicly.');
const dataDir = path.join(__dirname, 'data');
fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const db = new Database(path.join(dataDir, 'vkis.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS admissions (
 id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
 student TEXT NOT NULL, parent TEXT NOT NULL, dob TEXT NOT NULL, lastschool TEXT, class TEXT NOT NULL,
 occupation TEXT, phone TEXT NOT NULL, email TEXT NOT NULL, message TEXT, status TEXT NOT NULL DEFAULT 'New'
);
CREATE TABLE IF NOT EXISTS jobs (
 id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
 name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL,
 experience TEXT, qualification TEXT NOT NULL, message TEXT, status TEXT NOT NULL DEFAULT 'New'
);`);
const insertAdmission = db.prepare(`INSERT INTO admissions (student,parent,dob,lastschool,class,occupation,phone,email,message) VALUES (@student,@parent,@dob,@lastschool,@class,@occupation,@phone,@email,@message)`);
const insertJob = db.prepare(`INSERT INTO jobs (name,phone,email,role,experience,qualification,message) VALUES (@name,@phone,@email,@role,@experience,@qualification,@message)`);

app.disable('x-powered-by');
if (PROD) app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: { directives: {
  defaultSrc: ["'self'"], scriptSrc: ["'self'", "'unsafe-inline'"], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'], fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], objectSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"]
} } }));
app.use(express.json({ limit: '20kb', type: 'application/json' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));
app.use(session({
 secret: SESSION_SECRET,
 store: new SQLiteStore({ db: 'sessions.sqlite', dir: dataDir, table: 'sessions' }),
 resave: false, saveUninitialized: false,
 cookie: { httpOnly: true, secure: PROD, sameSite: 'strict', maxAge: 1000 * 60 * 60 * 2 },
 name: 'vkis_admin_session'
}));
const publicDir = path.join(__dirname, 'public');
app.use(express.static(publicDir, { index: 'index.html', maxAge: PROD ? '1h' : 0, etag: true }));
const publicSubmitLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many submissions. Please wait and try again, or contact the school.' } });
const loginLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many login attempts. Please wait before trying again.' } });
function clean(value, max = 2000) { return String(value ?? '').trim().replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, max); }
function validEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 180; }
function validPhone(s) { return /^[+0-9() -]{10,18}$/.test(s); }
function required(body, fields) { return fields.every(k => typeof body[k] === 'string' && body[k].trim().length > 0); }
function originGuard(req, res, next) {
  const origin = req.get('origin');
  const expected = process.env.ALLOWED_ORIGIN || `${req.protocol}://${req.get('host')}`;
  if (origin && origin !== expected) return res.status(403).json({ error: 'Origin not allowed.' });
  next();
}
function adminOnly(req, res, next) { if (req.session && req.session.isAdmin === true) return next(); return res.status(401).json({ error: 'Please sign in to the staff portal.' }); }
app.get('/staff-portal-128', (req, res) => res.sendFile(path.join(__dirname, 'private', 'admin.html')));
app.get('/api/session', (req, res) => res.json({ authenticated: !!(req.session && req.session.isAdmin) }));
app.post('/api/login', loginLimit, originGuard, async (req, res, next) => {
  try {
    const password = clean(req.body && req.body.password, 500);
    const a = Buffer.from(password); const b = Buffer.from(ADMIN_PASSWORD);
    const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
    if (!ok) return res.status(401).json({ error: 'Incorrect password.' });
    req.session.regenerate(err => { if (err) return next(err); req.session.isAdmin = true; req.session.save(err2 => { if (err2) return next(err2); res.json({ ok: true }); }); });
  } catch (e) { next(e); }
});
app.post('/api/logout', adminOnly, (req, res) => req.session.destroy(() => { res.clearCookie('vkis_admin_session', { httpOnly: true, secure: PROD, sameSite: 'strict' }); res.json({ ok: true }); }));
app.post('/api/admissions', publicSubmitLimit, originGuard, (req, res) => {
  const b = req.body || {};
  if (!required(b, ['student','parent','dob','class','phone','email'])) return res.status(400).json({ error: 'Please complete all required admission fields.' });
  const v = { student: clean(b.student,120), parent: clean(b.parent,120), dob: clean(b.dob,10), lastschool: clean(b.lastschool,180), class: clean(b.class,80), occupation: clean(b.occupation,120), phone: clean(b.phone,18), email: clean(b.email,180), message: clean(b.message,2000) };
  if (!validEmail(v.email) || !validPhone(v.phone) || !/^\d{4}-\d{2}-\d{2}$/.test(v.dob)) return res.status(400).json({ error: 'Please check the email, mobile number and date of birth.' });
  insertAdmission.run(v); res.status(201).json({ message: 'Admission enquiry received. The school team can now review it.' });
});
app.post('/api/jobs', publicSubmitLimit, originGuard, (req, res) => {
  const b = req.body || {};
  if (!required(b, ['name','phone','email','role','qualification'])) return res.status(400).json({ error: 'Please complete all required job application fields.' });
  const v = { name: clean(b.name,120), phone: clean(b.phone,18), email: clean(b.email,180), role: clean(b.role,120), experience: clean(b.experience,100), qualification: clean(b.qualification,180), message: clean(b.message,2000) };
  if (!validEmail(v.email) || !validPhone(v.phone)) return res.status(400).json({ error: 'Please check the email address and mobile number.' });
  insertJob.run(v); res.status(201).json({ message: 'Job application received. Thank you for your interest.' });
});
app.get('/api/admin/admissions', adminOnly, (req, res) => res.json(db.prepare('SELECT * FROM admissions ORDER BY id DESC LIMIT 1000').all()));
app.get('/api/admin/jobs', adminOnly, (req, res) => res.json(db.prepare('SELECT * FROM jobs ORDER BY id DESC LIMIT 1000').all()));
app.patch('/api/admin/:type/:id/status', adminOnly, originGuard, (req, res) => {
  const type = req.params.type; const id = Number(req.params.id); const status = clean(req.body && req.body.status,30);
  if (!Number.isSafeInteger(id) || id < 1 || !['New','Reviewing','Contacted','Closed'].includes(status)) return res.status(400).json({ error: 'Invalid status update.' });
  if (!['admissions','jobs'].includes(type)) return res.status(404).json({ error: 'Not found.' });
  const info = db.prepare(`UPDATE ${type} SET status = ? WHERE id = ?`).run(status,id);
  if (!info.changes) return res.status(404).json({ error: 'Record not found.' }); res.json({ ok: true });
});
app.get('/api/admin/export/:type.csv', adminOnly, (req,res) => {
  const type=req.params.type; if(!['admissions','jobs'].includes(type)) return res.status(404).end();
  const rows=db.prepare(`SELECT * FROM ${type} ORDER BY id DESC`).all();
  const esc=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
  const keys=rows.length?Object.keys(rows[0]):(type==='admissions'?['id','created_at','student','parent','dob','lastschool','class','occupation','phone','email','message','status']:['id','created_at','name','phone','email','role','experience','qualification','message','status']);
  res.setHeader('Content-Type','text/csv; charset=utf-8'); res.setHeader('Content-Disposition',`attachment; filename="vkis-${type}.csv"`); res.send([keys.map(esc).join(','),...rows.map(r=>keys.map(k=>esc(r[k])).join(','))].join('\r\n'));
});
app.use((err, req, res, next) => { console.error(err && err.message ? err.message : 'Request error'); if (res.headersSent) return next(err); res.status(500).json({ error: 'A server error occurred. Please try again later.' }); });
app.listen(PORT, () => console.log(`VKIS website running on port ${PORT}`));
