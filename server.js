// server.js
// เซิร์ฟเวอร์หลักของระบบล็อคอิน (Express + PostgreSQL + Session)
require('dotenv').config();

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const db = require('./database');
const ai = require('./ai');
const { sendMail, missingMailConfig, apiKeyProblem, explainMailError } = require('./mailer');
const google = require('./googleAuth');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

// หมวดหมู่มาตรฐาน (รายจ่ายและรายรับ) และความยาวสูงสุดของชื่อหมวดหมู่ที่ผู้ใช้สร้างเอง
const MAX_CATEGORY_LENGTH = 20;
const BUILTIN_CATEGORIES = [
  'food', 'travel', 'entertainment', 'shopping', 'other',
  'income', 'allowance', 'salary', 'parttime', 'scholarship', 'sales'
];

// ค่าที่อนุญาตสำหรับธีม: โหมดการแสดงผล และสีหลักแบบ #RRGGBB
const THEME_MODES = ['dark', 'light', 'system'];
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

// เมื่อรันหลัง reverse proxy ของโฮสติ้ง (เช่น Render) ต้อง trust proxy
// เพื่อให้ secure cookie ทำงานถูกต้องผ่าน HTTPS
if (isProduction) {
  app.set('trust proxy', 1);
}

// ----- Middleware -----
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-secret-key-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: isProduction, // ใช้ true เมื่อรันจริงผ่าน HTTPS เท่านั้น
    maxAge: 1000 * 60 * 60 * 24 // 1 วัน
  }
}));

// ป้องกันหน้า app.html ไม่ให้เข้าถึงได้โดยตรงถ้ายังไม่ได้ล็อคอิน (เผื่อพิมพ์ URL เข้ามาตรง ๆ)
app.get('/app.html', (req, res, next) => {
  if (!req.session || !req.session.userId) {
    return res.redirect('/login.html');
  }
  next();
});

// ป้องกันหน้า admin.html: ต้องล็อคอินและต้องเป็นแอดมินเท่านั้นถึงจะเข้าได้
app.get('/admin.html', async (req, res, next) => {
  if (!req.session || !req.session.userId) {
    return res.redirect('/login.html');
  }
  try {
    const user = await db.findById(req.session.userId);
    if (!user || user.role !== 'admin') {
      return res.redirect('/app.html');
    }
    next();
  } catch (err) {
    console.error(err);
    return res.redirect('/app.html');
  }
});

// เสิร์ฟไฟล์หน้าเว็บ (HTML/CSS/JS) จากโฟลเดอร์ public
app.use(express.static(path.join(__dirname, 'public')));

// ----- Middleware ตรวจสอบว่าล็อคอินอยู่หรือไม่ -----
function requireLogin(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อน' });
}

// ----- Middleware ตรวจสอบว่าเป็นแอดมิน (เช็คจากฐานข้อมูลจริงทุกครั้ง ไม่เชื่อค่าจาก frontend) -----
async function requireAdmin(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อน' });
  }
  try {
    const user = await db.findById(req.session.userId);
    if (!user || user.role !== 'admin') {
      return res.status(403).json({ error: 'ต้องเป็นแอดมินเท่านั้นถึงจะใช้งานส่วนนี้ได้' });
    }
    req.currentUser = user;
    return next();
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' });
  }
}

// ----- API: สมัครสมาชิก -----
app.post('/api/register', async (req, res) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบทุกช่อง' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' });
    }

    const exists = await db.userExists(username, email);
    if (exists) {
      return res.status(409).json({ error: 'มีชื่อผู้ใช้หรืออีเมลนี้ในระบบแล้ว' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await db.createUser({ username, email, passwordHash });

    req.session.userId = user.id;
    req.session.username = user.username;

    return res.status(201).json({ message: 'สมัครสมาชิกสำเร็จ', username });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' });
  }
});

// ----- API: เข้าสู่ระบบ -----
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });
    }

    const user = await db.findByLogin(username);

    if (!user) {
      return res.status(401).json({ error: 'ไม่พบผู้ใช้นี้ในระบบ' });
    }
    if (!user.password_hash) {
      return res.status(401).json({ error: 'บัญชีนี้สมัครด้วย Google กรุณากด "เข้าสู่ระบบด้วย Google" (หรือใช้ "ลืมรหัสผ่าน" เพื่อตั้งรหัสผ่าน)' });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ error: 'รหัสผ่านไม่ถูกต้อง' });
    }

    req.session.userId = user.id;
    req.session.username = user.username;

    return res.json({ message: 'เข้าสู่ระบบสำเร็จ', username: user.username });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' });
  }
});

// ----- API: ออกจากระบบ -----
app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'ออกจากระบบไม่สำเร็จ' });
    }
    res.clearCookie('connect.sid');
    return res.json({ message: 'ออกจากระบบแล้ว' });
  });
});

// ===================== ลืมรหัสผ่าน / ตั้งรหัสผ่านใหม่ =====================

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000; // ลิงก์ใช้ได้ 30 นาที
const RESET_TOKEN_FORMAT = /^[a-f0-9]{64}$/;

// เก็บเฉพาะ hash ของโทเค็นในฐานข้อมูล ถ้าฐานข้อมูลรั่ว คนอื่นก็เอาไปใช้รีเซ็ตรหัสผ่านไม่ได้
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ค่าที่ยังไม่ได้ตั้งสำหรับระบบส่งอีเมล (ว่างแปลว่าพร้อมใช้งาน)
function mailSetupProblems() {
  const missing = missingMailConfig();
  if (!process.env.APP_URL) missing.push('APP_URL');
  return missing;
}

// เช็คจาก IP ที่ต่อเข้ามาจริง (ปลอมผ่าน header ไม่ได้) — จริงเฉพาะตอนเปิดเว็บจากเครื่องตัวเอง
// ต้องเช็คทั้ง IP และชื่อโฮสต์: บน Render คำขอจาก proxy ก็มาจาก 127.0.0.1 เหมือนกัน
// ถ้าเช็คแค่ IP จะคิดว่าเป็น localhost แล้วสร้าง redirect URI เป็น http://<โดเมน Render> (Google ตอบ redirect_uri_mismatch)
const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]', '::1'];
function isLocalRequest(req) {
  const fromLoopback = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
  const host = String(req.get('host') || '').toLowerCase().replace(/:\d+$/, '');
  return fromLoopback && LOCAL_HOSTNAMES.includes(host);
}

// ซ่อนอีเมลบางส่วนใน log เช่น mi***@example.com
function maskEmail(email) {
  const [name, domain] = String(email).split('@');
  return `${name.slice(0, 2)}***@${domain || ''}`;
}

// จำกัดจำนวนครั้งที่ขอได้ในช่วงเวลาหนึ่ง (เก็บในหน่วยความจำ รีสตาร์ทเซิร์ฟเวอร์แล้วนับใหม่)
const rateBuckets = new Map();
function tooManyRequests(key, limit, windowMs) {
  const now = Date.now();
  const recent = (rateBuckets.get(key) || []).filter((t) => now - t < windowMs);
  recent.push(now);
  rateBuckets.set(key, recent);
  if (rateBuckets.size > 5000) {
    for (const [k, times] of rateBuckets) {
      if (times.every((t) => now - t >= windowMs)) rateBuckets.delete(k);
    }
  }
  return recent.length > limit;
}

// ----- API: ขอลิงก์ตั้งรหัสผ่านใหม่ทางอีเมล -----
app.post('/api/password/forgot', async (req, res) => {
  const email = typeof req.body.email === 'string' ? req.body.email.trim() : '';
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'กรุณากรอกอีเมลให้ถูกต้อง' });
  }
  if (tooManyRequests(`forgot-ip:${req.ip}`, 5, 15 * 60 * 1000) ||
      tooManyRequests(`forgot-email:${email.toLowerCase()}`, 3, 60 * 60 * 1000)) {
    return res.status(429).json({ error: 'ขอลิงก์บ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่' });
  }

  // นอกจากตอนทดสอบบน localhost ต้องตั้งค่าอีเมลครบ ไม่งั้นแจ้ง error ตรง ๆ แทนการบอกว่า "ส่งแล้ว"
  // ลิงก์ต้องชี้ไปที่เว็บของเราเสมอ จึงใช้ APP_URL (ไม่เชื่อ Host header ที่ส่งมา ยกเว้นบน localhost)
  const problems = mailSetupProblems();
  if (problems.length > 0 && !isLocalRequest(req)) {
    console.error(`[ลืมรหัสผ่าน] ส่งอีเมลไม่ได้ ยังไม่ได้ตั้งค่า: ${problems.join(', ')}`);
    return res.status(503).json({ error: 'ระบบส่งอีเมลยังไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแลระบบ' });
  }
  const baseUrl = process.env.APP_URL || `${req.protocol}://${req.get('host')}`;

  // ตอบข้อความเดียวกันเสมอ และตอบก่อนส่งอีเมล เพื่อไม่ให้ใครใช้หน้านี้เช็คได้ว่าอีเมลไหนมีบัญชี
  res.json({ message: 'ถ้าอีเมลนี้มีบัญชีอยู่ในระบบ เราได้ส่งลิงก์ตั้งรหัสผ่านใหม่ไปให้แล้ว กรุณาตรวจสอบกล่องจดหมาย (รวมถึงโฟลเดอร์สแปม)' });

  try {
    const user = await db.findByEmail(email);
    if (!user) {
      console.log(`[ลืมรหัสผ่าน] ไม่พบบัญชีที่ใช้อีเมล ${maskEmail(email)} — ไม่ได้ส่งอีเมล`);
      return;
    }

    const token = crypto.randomBytes(32).toString('hex');
    await db.createPasswordReset(user.id, hashToken(token), new Date(Date.now() + RESET_TOKEN_TTL_MS));
    const link = `${baseUrl.replace(/\/+$/, '')}/reset-password.html?token=${token}`;

    const sent = await sendMail({
      to: user.email,
      subject: 'ตั้งรหัสผ่านใหม่ — MoneyMate',
      text: `สวัสดีคุณ ${user.username}\n\nเราได้รับคำขอตั้งรหัสผ่านใหม่สำหรับบัญชี MoneyMate ของคุณ\nกดลิงก์นี้เพื่อตั้งรหัสผ่านใหม่ (ใช้ได้ภายใน 30 นาที และใช้ได้ครั้งเดียว):\n${link}\n\nถ้าคุณไม่ได้เป็นคนขอ ไม่ต้องทำอะไร รหัสผ่านเดิมยังใช้ได้ตามปกติ`,
      html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;color:#17211E;line-height:1.6">
        <h2 style="margin:0 0 16px">Money<span style="color:#1C9C70">Mate</span></h2>
        <p>สวัสดีคุณ ${escapeHtml(user.username)}</p>
        <p>เราได้รับคำขอตั้งรหัสผ่านใหม่สำหรับบัญชี MoneyMate ของคุณ กดปุ่มด้านล่างเพื่อตั้งรหัสผ่านใหม่</p>
        <p style="margin:24px 0"><a href="${link}" style="background:#2FBF8F;color:#06231B;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:bold">ตั้งรหัสผ่านใหม่</a></p>
        <p style="font-size:13px;color:#5E6864">ลิงก์นี้ใช้ได้ภายใน 30 นาที และใช้ได้ครั้งเดียว<br>ถ้าคุณไม่ได้เป็นคนขอ ไม่ต้องทำอะไร รหัสผ่านเดิมยังใช้ได้ตามปกติ</p>
        <p style="font-size:12px;color:#8A938F;word-break:break-all">ถ้ากดปุ่มไม่ได้ ให้คัดลอกลิงก์นี้ไปเปิดในเบราว์เซอร์:<br>${link}</p>
      </div>`
    });
    if (!sent.simulated) {
      console.log(`[ลืมรหัสผ่าน] ส่งลิงก์ไปที่ ${maskEmail(user.email)} แล้ว (Brevo messageId: ${sent.messageId})`);
    }
  } catch (err) {
    console.error(`[ลืมรหัสผ่าน] ส่งอีเมลไม่สำเร็จ: ${err.message}\n  วิธีแก้: ${explainMailError(err)}`);
  }
});

// ----- API: เช็คว่าลิงก์ตั้งรหัสผ่านใหม่ยังใช้ได้อยู่ไหม (ให้หน้าเว็บแจ้งได้ทันทีถ้าหมดอายุ) -----
app.post('/api/password/reset/check', async (req, res) => {
  try {
    const { token } = req.body;
    if (typeof token !== 'string' || !RESET_TOKEN_FORMAT.test(token)) {
      return res.json({ valid: false });
    }
    const reset = await db.findValidPasswordReset(hashToken(token));
    return res.json({ valid: Boolean(reset) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' });
  }
});

// ----- API: ตั้งรหัสผ่านใหม่ด้วยโทเค็นจากอีเมล -----
app.post('/api/password/reset', async (req, res) => {
  try {
    const { token, password } = req.body;
    if (tooManyRequests(`reset-ip:${req.ip}`, 10, 15 * 60 * 1000)) {
      return res.status(429).json({ error: 'ลองบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่' });
    }
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' });
    }
    const expiredMessage = 'ลิงก์นี้หมดอายุหรือถูกใช้ไปแล้ว กรุณาขอลิงก์ใหม่อีกครั้ง';
    if (typeof token !== 'string' || !RESET_TOKEN_FORMAT.test(token)) {
      return res.status(400).json({ error: expiredMessage });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const ok = await db.resetPassword(hashToken(token), passwordHash);
    if (!ok) {
      return res.status(400).json({ error: expiredMessage });
    }
    return res.json({ message: 'ตั้งรหัสผ่านใหม่เรียบร้อยแล้ว' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' });
  }
});

// ===================== ล็อกอินด้วย Google =====================
// บัญชีใหม่: สร้างให้อัตโนมัติ / บัญชีที่มีอีเมลนี้อยู่แล้ว: ต้องล็อกอินด้วยรหัสผ่านแล้วกด "เชื่อมบัญชี Google" ในโปรไฟล์
// (ไม่ผูกให้อัตโนมัติจากอีเมล เพราะตอนสมัครไม่ได้ยืนยันอีเมล — กันคนอื่นสมัครดักด้วยอีเมลของเราไว้ก่อน)

const GOOGLE_LOGIN_TIMEOUT_MS = 10 * 60 * 1000;

// URL ที่ Google จะส่งผู้ใช้กลับมา ต้องตรงกับที่ลงทะเบียนไว้ใน Google Cloud Console ทุกตัวอักษร
function googleRedirectUri(req) {
  const base = isLocalRequest(req) ? `${req.protocol}://${req.get('host')}` : (process.env.APP_URL || '').trim();
  return base ? `${base.replace(/\/+$/, '')}/auth/google/callback` : '';
}

// ตั้งชื่อผู้ใช้จากอีเมล Google เช่น somchai.k@gmail.com -> somchai.k (ถ้าซ้ำจะเติมเลขต่อท้าย)
async function uniqueUsername(email) {
  const base = email.split('@')[0].replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 20) || 'user';
  for (let i = 1; i <= 50; i++) {
    const candidate = i === 1 ? base : `${base}${i}`;
    if (!(await db.usernameTaken(candidate))) return candidate;
  }
  return `${base}${crypto.randomBytes(3).toString('hex')}`;
}

// ----- API: หน้าเว็บเช็คว่าเปิดใช้ล็อกอินด้วย Google หรือยัง (ถ้ายังจะซ่อนปุ่ม) -----
app.get('/api/auth/providers', (req, res) => {
  res.json({ google: google.missingGoogleConfig().length === 0 });
});

// ----- เริ่มล็อกอิน / เชื่อมบัญชีด้วย Google: พาไปหน้าเลือกบัญชีของ Google -----
app.get('/auth/google', (req, res) => {
  const mode = req.query.mode === 'link' ? 'link' : 'login';
  const back = mode === 'link' ? '/app.html' : '/login.html';
  const missing = google.missingGoogleConfig();
  const redirectUri = googleRedirectUri(req);
  if (missing.length > 0 || !redirectUri) {
    console.error(`[Google] ยังตั้งค่าไม่ครบ: ${[...missing, ...(redirectUri ? [] : ['APP_URL'])].join(', ')}`);
    return res.redirect(`${back}?google=unavailable`);
  }
  if (mode === 'link' && !req.session.userId) {
    return res.redirect('/login.html');
  }

  const state = google.randomToken();
  const codeVerifier = google.randomToken();
  req.session.googleOAuth = { state, codeVerifier, mode, redirectUri, userId: req.session.userId || null, startedAt: Date.now() };
  req.session.save((err) => {
    if (err) {
      console.error(err);
      return res.redirect(`${back}?google=failed`);
    }
    return res.redirect(google.buildAuthUrl({ redirectUri, state, codeVerifier }));
  });
});

// ----- Google ส่งผู้ใช้กลับมาที่นี่ -----
app.get('/auth/google/callback', async (req, res) => {
  const pending = req.session.googleOAuth;
  delete req.session.googleOAuth;
  const back = pending && pending.mode === 'link' ? '/app.html' : '/login.html';
  const fail = (code) => res.redirect(`${back}?google=${code}`);

  // state ต้องตรงกับที่เราสร้างไว้ในเซสชันนี้ (กันคนอื่นส่งลิงก์ callback ปลอมมาให้กด)
  if (!pending || typeof req.query.state !== 'string' || req.query.state !== pending.state ||
      Date.now() - pending.startedAt > GOOGLE_LOGIN_TIMEOUT_MS) {
    return fail('expired');
  }
  if (req.query.error) return fail('cancelled');
  if (typeof req.query.code !== 'string') return fail('failed');

  let profile;
  try {
    profile = await google.fetchGoogleProfile({ code: req.query.code, redirectUri: pending.redirectUri, codeVerifier: pending.codeVerifier });
  } catch (err) {
    console.error(`[Google] ${err.message}`);
    return fail('failed');
  }
  if (!profile.email || !profile.emailVerified) return fail('unverified');

  try {
    const owner = await db.findByGoogleId(profile.sub);

    if (pending.mode === 'link') {
      if (!req.session.userId || req.session.userId !== pending.userId) return res.redirect('/login.html');
      if (owner && owner.id !== req.session.userId) return fail('in_use');
      await db.linkGoogle(req.session.userId, profile.sub, profile.email);
      return res.redirect('/app.html?google=linked');
    }

    let user = owner;
    if (!user) {
      if (await db.findByEmail(profile.email)) return fail('email_exists');
      user = await db.createGoogleUser({ username: await uniqueUsername(profile.email), email: profile.email, googleId: profile.sub });
      console.log(`[Google] สร้างบัญชีใหม่: ${user.username}`);
    }

    // ออกเซสชันใหม่ตอนล็อกอิน (กัน session fixation)
    req.session.regenerate((err) => {
      if (err) {
        console.error(err);
        return res.redirect('/login.html?google=failed');
      }
      req.session.userId = user.id;
      req.session.username = user.username;
      return res.redirect('/app.html');
    });
  } catch (err) {
    console.error(err);
    return fail('failed');
  }
});

// ----- API: ยกเลิกการเชื่อมบัญชี Google (ต้องมีรหัสผ่านก่อน ไม่งั้นจะเข้าบัญชีไม่ได้อีก) -----
app.post('/api/auth/google/unlink', requireLogin, async (req, res) => {
  try {
    const user = await db.findById(req.session.userId);
    if (!user || !user.google_id) {
      return res.status(400).json({ error: 'บัญชีนี้ยังไม่ได้เชื่อมกับ Google' });
    }
    if (!user.password_hash) {
      return res.status(400).json({ error: 'บัญชีนี้ยังไม่มีรหัสผ่าน ตั้งรหัสผ่านก่อน (ใช้ "ลืมรหัสผ่าน" ที่หน้าเข้าสู่ระบบ) แล้วค่อยยกเลิกการเชื่อม Google' });
    }
    await db.unlinkGoogle(user.id);
    return res.json({ message: 'ยกเลิกการเชื่อมบัญชี Google แล้ว' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' });
  }
});

// ----- API: ดึงข้อมูลผู้ใช้ที่ล็อคอินอยู่ -----
app.get('/api/me', requireLogin, async (req, res) => {
  try {
    const user = await db.findById(req.session.userId);
    if (!user) {
      return res.status(401).json({ error: 'ไม่พบผู้ใช้นี้ในระบบ' });
    }
    const { password_hash, google_id, ...safeUser } = user;
    return res.json({ user: { ...safeUser, has_password: Boolean(password_hash), google_linked: Boolean(google_id) } });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' });
  }
});

// ----- ตัวอย่างหน้าที่ต้องล็อคอินก่อนถึงจะเข้าได้ -----
app.get('/api/protected-example', requireLogin, (req, res) => {
  return res.json({ message: `สวัสดีคุณ ${req.session.username}, นี่คือข้อมูลลับที่เห็นได้เฉพาะสมาชิก` });
});

// ----- API: ดึงรายการรายรับ-รายจ่ายทั้งหมดของผู้ใช้ที่ล็อคอินอยู่ -----
app.get('/api/transactions', requireLogin, async (req, res) => {
  try {
    const transactions = await db.getTransactions(req.session.userId);
    return res.json({ transactions });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' });
  }
});

// ----- API: เพิ่มรายการรายรับ-รายจ่าย -----
app.post('/api/transactions', requireLogin, async (req, res) => {
  try {
    const { type, cat, title, amount, date } = req.body;

    if (type !== 'income' && type !== 'expense') {
      return res.status(400).json({ error: 'ประเภทรายการไม่ถูกต้อง' });
    }

    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) {
      return res.status(400).json({ error: 'กรุณาระบุจำนวนเงินให้ถูกต้อง' });
    }

    const txDate = date ? new Date(date) : new Date();
    if (isNaN(txDate.getTime())) {
      return res.status(400).json({ error: 'วันที่ไม่ถูกต้อง' });
    }

    const cleanCat = typeof cat === 'string' ? cat.trim().slice(0, MAX_CATEGORY_LENGTH) : '';
    const transaction = await db.createTransaction({
      userId: req.session.userId,
      type,
      cat: cleanCat || (type === 'income' ? 'income' : 'other'),
      title: (title || '').trim(),
      amount: amt,
      date: txDate
    });

    return res.status(201).json({ transaction });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' });
  }
});

// ----- API: ลบรายการรายรับ-รายจ่าย -----
app.delete('/api/transactions/:id', requireLogin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'รหัสรายการไม่ถูกต้อง' });
    }

    const deleted = await db.deleteTransaction(id, req.session.userId);
    if (!deleted) {
      return res.status(404).json({ error: 'ไม่พบรายการนี้' });
    }

    return res.json({ message: 'ลบรายการแล้ว' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' });
  }
});

// ----- API: หมวดหมู่รายจ่ายที่ผู้ใช้สร้างเอง -----

app.get('/api/categories', requireLogin, async (req, res) => {
  try {
    const categories = await db.getCategories(req.session.userId);
    return res.json({ categories });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' });
  }
});

app.post('/api/categories', requireLogin, async (req, res) => {
  try {
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const type = req.body.type === undefined ? 'expense' : req.body.type;
    if (type !== 'income' && type !== 'expense') {
      return res.status(400).json({ error: 'ประเภทหมวดหมู่ไม่ถูกต้อง' });
    }
    if (!name) {
      return res.status(400).json({ error: 'กรุณาระบุชื่อหมวดหมู่' });
    }
    if (name.length > MAX_CATEGORY_LENGTH) {
      return res.status(400).json({ error: `ชื่อหมวดหมู่ยาวได้ไม่เกิน ${MAX_CATEGORY_LENGTH} ตัวอักษร` });
    }
    if (BUILTIN_CATEGORIES.includes(name.toLowerCase())) {
      return res.status(400).json({ error: 'ชื่อนี้ถูกใช้เป็นหมวดหมู่มาตรฐานแล้ว' });
    }
    const category = await db.createCategory(req.session.userId, type, name);
    return res.status(201).json({ category });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' });
  }
});

// ----- API: แผนการเงินล่วงหน้า -----
const MAX_PLAN_ITEMS = 100;
const MAX_PLAN_NAME = 40;

// ตรวจและแปลงข้อมูลรายการในแผน คืน { error } ถ้าไม่ถูกต้อง
function parsePlanItem(body) {
  const type = body.type;
  if (type !== 'income' && type !== 'expense') return { error: 'ประเภทรายการไม่ถูกต้อง' };
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return { error: 'กรุณาระบุชื่อรายการ' };
  if (name.length > MAX_PLAN_NAME) return { error: `ชื่อรายการยาวได้ไม่เกิน ${MAX_PLAN_NAME} ตัวอักษร` };
  const amount = Math.round(parseFloat(body.amount) * 100) / 100;
  if (!isFinite(amount) || amount <= 0 || amount >= 1e10) return { error: 'กรุณาระบุจำนวนเงินให้ถูกต้อง' };
  const freq = body.freq;
  if (!['daily', 'weekly', 'monthly', 'once'].includes(freq)) return { error: 'ความถี่ไม่ถูกต้อง' };
  let day = null, onDate = null;
  if (freq === 'monthly' || freq === 'weekly') {
    day = parseInt(body.day, 10);
    const [lo, hi] = freq === 'monthly' ? [1, 31] : [0, 6];
    if (isNaN(day) || day < lo || day > hi) return { error: 'วันที่ของรายการไม่ถูกต้อง' };
  }
  if (freq === 'once') {
    onDate = typeof body.onDate === 'string' ? body.onDate : '';
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(onDate);
    const d = m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (!d || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return { error: 'วันที่ของรายการไม่ถูกต้อง' };
  }
  const cat = typeof body.cat === 'string' && body.cat.trim() ? body.cat.trim().slice(0, MAX_CATEGORY_LENGTH) : null;
  return { item: { type, name, amount, freq, day, onDate, cat } };
}

app.get('/api/plan', requireLogin, async (req, res) => {
  try {
    const items = await db.getPlanItems(req.session.userId);
    return res.json({ items });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' });
  }
});

app.post('/api/plan', requireLogin, async (req, res) => {
  try {
    const { item, error } = parsePlanItem(req.body || {});
    if (error) return res.status(400).json({ error });
    if (await db.countPlanItems(req.session.userId) >= MAX_PLAN_ITEMS) {
      return res.status(400).json({ error: `มีรายการในแผนได้ไม่เกิน ${MAX_PLAN_ITEMS} รายการ` });
    }
    const saved = await db.createPlanItem(req.session.userId, item);
    return res.status(201).json({ item: saved });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' });
  }
});

app.put('/api/plan/:id', requireLogin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'รหัสรายการไม่ถูกต้อง' });
    const { item, error } = parsePlanItem(req.body || {});
    if (error) return res.status(400).json({ error });
    const saved = await db.updatePlanItem(id, req.session.userId, item);
    if (!saved) return res.status(404).json({ error: 'ไม่พบรายการนี้' });
    return res.json({ item: saved });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' });
  }
});

app.delete('/api/plan/:id', requireLogin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'รหัสรายการไม่ถูกต้อง' });
    const deleted = await db.deletePlanItem(id, req.session.userId);
    if (!deleted) return res.status(404).json({ error: 'ไม่พบรายการนี้' });
    return res.json({ message: 'ลบรายการแล้ว' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' });
  }
});

// ----- API: ผู้ช่วย AI (Gemini) -----
// ทุกคำขอต้องล็อกอิน + ผู้ใช้กดยินยอมแล้ว + ยังไม่เกินโควตารายวัน
const AI_ERRORS = {
  quota: [429, 'โควตา AI ของระบบเต็มชั่วคราว ลองใหม่ภายหลัง'],
  config: [503, 'ระบบ AI ยังตั้งค่าไม่ถูกต้อง'],
  blocked: [422, 'AI ตอบคำถามนี้ไม่ได้ ลองถามแบบอื่น'],
  empty: [502, 'AI ตอบกลับไม่สำเร็จ ลองใหม่อีกครั้ง'],
  upstream: [502, 'เชื่อมต่อ AI ไม่สำเร็จ ลองใหม่อีกครั้ง'],
  timeout: [504, 'AI ตอบช้าเกินไป ลองใหม่อีกครั้ง']
};
const clip = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
const aiLang = (req) => (req.body && req.body.lang === 'en' ? 'en' : 'th');
const aiTz = (req) => { // นาทีจาก Date.getTimezoneOffset() ของผู้ใช้ (ไทย = -420)
  const v = parseInt(req.body && req.body.tzOffset !== undefined ? req.body.tzOffset : req.query.tzOffset, 10);
  return isNaN(v) ? -420 : Math.max(-840, Math.min(840, v));
};
const aiDay = (req) => new Date(Date.now() - aiTz(req) * 60000).toISOString().slice(0, 10);

function sendAiError(res, err) {
  if (!(err instanceof ai.AiError)) { console.error(err); return res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์', code: 'server' }); }
  if (err.code !== 'quota') console.warn('[AI]', err.code, err.message);
  const [status, error] = AI_ERRORS[err.code] || AI_ERRORS.upstream;
  return res.status(status).json({ error, code: err.code });
}

// ตรวจสิทธิ์ก่อนเรียก AI — คืนจำนวนครั้งที่ใช้ไปแล้ววันนี้ หรือ null ถ้าส่งคำตอบปฏิเสธไปแล้ว
async function aiGate(req, res, { countsQuota = true } = {}) {
  if (!ai.enabled()) { res.status(503).json({ error: 'ยังไม่ได้เปิดใช้ AI', code: 'disabled' }); return null; }
  const settings = await db.getSettings(req.session.userId);
  if (!settings.ai_consent) { res.status(403).json({ error: 'กรุณากดยินยอมก่อนใช้ผู้ช่วย AI', code: 'consent' }); return null; }
  const used = await db.getAiUsage(req.session.userId, aiDay(req));
  if (countsQuota && used >= ai.dailyLimit()) {
    res.status(429).json({ error: `วันนี้ใช้ AI ครบ ${ai.dailyLimit()} ครั้งแล้ว พรุ่งนี้ใช้ได้ใหม่`, code: 'limit', used, limit: ai.dailyLimit() });
    return null;
  }
  return used;
}

async function aiContext(req) {
  const uid = req.session.userId;
  const [txs, settings, budgets, plan] = await Promise.all([db.getTransactions(uid), db.getSettings(uid), db.getBudgets(uid), db.getPlanItems(uid)]);
  return ai.buildContext({ txs, settings, budgets, plan, tzOffset: aiTz(req) });
}

async function aiCall(req, opts) {
  const result = await ai.generate(opts);
  const used = await db.bumpAiUsage(req.session.userId, aiDay(req));
  return { result, used };
}

app.get('/api/ai/status', requireLogin, async (req, res) => {
  try {
    const settings = await db.getSettings(req.session.userId);
    const used = ai.enabled() ? await db.getAiUsage(req.session.userId, aiDay(req)) : 0;
    return res.json({ enabled: ai.enabled(), consent: !!settings.ai_consent, used, limit: ai.dailyLimit(), paid: ai.paidTier() });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' });
  }
});

app.put('/api/ai/consent', requireLogin, async (req, res) => {
  try {
    const on = !!(req.body && req.body.on);
    await db.setAiConsent(req.session.userId, on);
    return res.json({ consent: on });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' });
  }
});

// สรุปและคำแนะนำประจำเดือน — เก็บผลไว้ทั้งวัน กด "สร้างใหม่" (force) ถึงจะเรียก AI อีกครั้ง
app.post('/api/ai/insights', requireLogin, async (req, res) => {
  try {
    const lang = aiLang(req), key = `${aiDay(req)}|${lang}`;
    if (!req.body.force) {
      const gate = await aiGate(req, res, { countsQuota: false });
      if (gate === null) return;
      const cached = await db.getAiCache(req.session.userId, 'insights');
      if (cached && cached.cache_key === key) return res.json({ ...JSON.parse(cached.payload), cached: true, used: gate, limit: ai.dailyLimit() });
    }
    const gate = await aiGate(req, res);
    if (gate === null) return;
    const ctx = await aiContext(req);
    const task = lang === 'en'
      ? 'Analyse my spending this month (compare with the same period last month and previous months, budget pace, and my plan forecast). Return JSON: {"headline": string (max 12 words), "summary": string (2-3 sentences), "points": [{"tone": "good"|"warn"|"tip", "title": string (max 8 words), "detail": string (1-2 sentences with numbers)}]} with 3 to 5 points. Mix what is going well, what to watch, and concrete tips.'
      : 'วิเคราะห์การใช้เงินเดือนนี้ของฉัน (เทียบช่วงเดียวกันของเดือนก่อนและเดือนก่อนๆ จังหวะการใช้งบ และคาดการณ์จากแผน) ตอบเป็น JSON: {"headline": ข้อความสั้นไม่เกิน 1 ประโยค, "summary": 2-3 ประโยค, "points": [{"tone": "good"|"warn"|"tip", "title": หัวข้อสั้นๆ, "detail": 1-2 ประโยคพร้อมตัวเลข}]} จำนวน 3-5 ข้อ ให้มีทั้งสิ่งที่ทำได้ดี สิ่งที่ควรระวัง และคำแนะนำที่ทำได้จริง';
    const { result, used } = await aiCall(req, { system: ai.systemPrompt(lang, ctx), messages: [{ role: 'user', text: task }], json: true, temperature: 0.5 });
    const points = (Array.isArray(result.points) ? result.points : []).slice(0, 5)
      .map((p) => ({ tone: ['good', 'warn', 'tip'].includes(p && p.tone) ? p.tone : 'tip', title: clip(p && p.title, 90), detail: clip(p && p.detail, 360) }))
      .filter((p) => p.title || p.detail);
    const payload = { headline: clip(result.headline, 160), summary: clip(result.summary, 700), points, generatedAt: new Date().toISOString() };
    if (!payload.headline && !payload.summary && !points.length) throw new ai.AiError('empty', 'empty insights');
    await db.setAiCache(req.session.userId, 'insights', key, payload);
    return res.json({ ...payload, cached: false, used, limit: ai.dailyLimit() });
  } catch (err) {
    return sendAiError(res, err);
  }
});

// คำแนะนำเมื่อใช้เงินใกล้ถึงงบ (80% ขึ้นไป) หรือเกินงบ — ไม่ถึงเกณฑ์ก็ไม่เรียก AI
app.post('/api/ai/budget-advice', requireLogin, async (req, res) => {
  try {
    const gate0 = await aiGate(req, res, { countsQuota: false });
    if (gate0 === null) return;
    const ctx = await aiContext(req);
    const m = ctx.this_month;
    const level = m.budget > 0 && m.spent > m.budget ? 'over' : m.budget > 0 && m.spent >= m.budget * 0.8 ? 'near' : 'ok';
    if (level === 'ok') return res.json({ level });
    const lang = aiLang(req), key = `${aiDay(req)}|${level}|${lang}`;
    const cached = await db.getAiCache(req.session.userId, 'budget');
    if (cached && cached.cache_key === key) return res.json({ ...JSON.parse(cached.payload), cached: true, used: gate0, limit: ai.dailyLimit() });
    const gate = await aiGate(req, res);
    if (gate === null) return;
    const task = lang === 'en'
      ? `My spending this month is ${level === 'over' ? 'OVER' : 'close to'} my budget. Give me calm, practical advice for the rest of the month. Return JSON: {"message": string (1-2 sentences: where I stand and roughly how much per day I can still spend, or how much I went over), "tips": [string, string, string] (short, specific actions based on my categories)}`
      : `เดือนนี้ฉันใช้เงิน${level === 'over' ? 'เกินงบแล้ว' : 'ใกล้ถึงงบแล้ว'} ช่วยแนะนำแบบใจเย็นและทำได้จริงสำหรับวันที่เหลือของเดือน ตอบเป็น JSON: {"message": 1-2 ประโยค (ตอนนี้อยู่ตรงไหน ใช้ได้อีกประมาณวันละเท่าไร หรือเกินไปเท่าไร), "tips": [3 ข้อสั้นๆ เจาะจงตามหมวดที่ฉันใช้]}`;
    const { result, used } = await aiCall(req, { system: ai.systemPrompt(lang, ctx), messages: [{ role: 'user', text: task }], json: true, temperature: 0.5, maxTokens: 1200 });
    const payload = {
      level, spent: m.spent, budget: m.budget,
      message: clip(result.message, 400),
      tips: (Array.isArray(result.tips) ? result.tips : []).map((x) => clip(x, 200)).filter(Boolean).slice(0, 3),
      generatedAt: new Date().toISOString()
    };
    if (!payload.message) throw new ai.AiError('empty', 'empty advice');
    await db.setAiCache(req.session.userId, 'budget', key, payload);
    return res.json({ ...payload, cached: false, used, limit: ai.dailyLimit() });
  } catch (err) {
    return sendAiError(res, err);
  }
});

// แชทถาม-ตอบ (ประวัติแชทเก็บไว้ที่เบราว์เซอร์ ไม่บันทึกลงฐานข้อมูล)
app.post('/api/ai/chat', requireLogin, async (req, res) => {
  try {
    const raw = Array.isArray(req.body.messages) ? req.body.messages.slice(-12) : [];
    const messages = raw
      .map((m) => ({ role: m && m.role === 'model' ? 'model' : 'user', text: clip(m && m.text, 1000) }))
      .filter((m) => m.text);
    if (!messages.length || messages[messages.length - 1].role !== 'user') {
      return res.status(400).json({ error: 'กรุณาพิมพ์คำถาม', code: 'input' });
    }
    while (messages[0].role !== 'user') messages.shift();
    const gate = await aiGate(req, res);
    if (gate === null) return;
    const lang = aiLang(req);
    const ctx = await aiContext(req);
    const { result, used } = await aiCall(req, { system: ai.systemPrompt(lang, ctx), messages, temperature: 0.7, maxTokens: 1500 });
    return res.json({ reply: result.slice(0, 4000), used, limit: ai.dailyLimit() });
  } catch (err) {
    return sendAiError(res, err);
  }
});

// ผู้ช่วยวางแผน: เสนอรายการในแผน (ผู้ใช้กดเลือกเพิ่มเอง ระบบไม่บันทึกให้อัตโนมัติ)
app.post('/api/ai/plan', requireLogin, async (req, res) => {
  try {
    const goal = clip(req.body.goal, 300);
    if (goal.length < 3) return res.status(400).json({ error: 'กรุณาบอกเป้าหมายหรือสิ่งที่อยากให้ช่วยวางแผน', code: 'input' });
    const gate = await aiGate(req, res);
    if (gate === null) return;
    const lang = aiLang(req);
    const ctx = await aiContext(req);
    const task = (lang === 'en'
      ? 'Help me plan for this goal: "' + goal + '". Suggest up to 6 NEW plan items (do not repeat items already in plan_items) that make the goal realistic given my history and forecast — e.g. a monthly saving transfer as an expense named "Savings", realistic daily food caps, one-off purchases on a date. Return JSON: {"summary": string (2-4 sentences explaining the plan with numbers and whether it is realistic), "items": [{"type": "income"|"expense", "name": string, "amount": number, "freq": "daily"|"weekly"|"monthly"|"once", "day": integer (1-31 for monthly, 0-6 for weekly with 0 = Sunday, omit otherwise), "onDate": "YYYY-MM-DD" (only for once, must be after today)}]}'
      : 'ช่วยวางแผนเพื่อเป้าหมายนี้: "' + goal + '" เสนอรายการในแผนใหม่ไม่เกิน 6 รายการ (ห้ามซ้ำกับ plan_items ที่มีอยู่) ที่ทำให้เป้าหมายเป็นไปได้จริงตามประวัติและคาดการณ์ของฉัน เช่น เงินเก็บรายเดือน (ใส่เป็นรายจ่ายชื่อ "เงินเก็บ") เพดานค่ากินรายวันที่สมเหตุสมผล หรือรายการซื้อครั้งเดียวในวันที่กำหนด ตอบเป็น JSON: {"summary": 2-4 ประโยคอธิบายแผนพร้อมตัวเลข และบอกว่าเป็นไปได้จริงไหม, "items": [{"type": "income"|"expense", "name": ชื่อรายการภาษาไทย, "amount": ตัวเลข, "freq": "daily"|"weekly"|"monthly"|"once", "day": จำนวนเต็ม (1-31 ถ้ารายเดือน, 0-6 ถ้ารายสัปดาห์ 0 = อาทิตย์), "onDate": "YYYY-MM-DD" (เฉพาะครั้งเดียว ต้องหลังวันนี้)}]}');
    const { result, used } = await aiCall(req, { system: ai.systemPrompt(lang, ctx), messages: [{ role: 'user', text: task }], json: true, temperature: 0.4 });
    const items = (Array.isArray(result.items) ? result.items : []).slice(0, 6)
      .map((x) => parsePlanItem(x || {}))
      .filter((p) => p.item && (p.item.freq !== 'once' || p.item.onDate > ctx.today))
      .map((p) => p.item);
    const summary = clip(result.summary, 800);
    if (!summary && !items.length) throw new ai.AiError('empty', 'empty plan');
    return res.json({ summary, items, used, limit: ai.dailyLimit() });
  } catch (err) {
    return sendAiError(res, err);
  }
});

app.delete('/api/categories/:id', requireLogin, async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'รหัสหมวดหมู่ไม่ถูกต้อง' });
    }
    const deleted = await db.deleteCategory(id, req.session.userId);
    if (!deleted) {
      return res.status(404).json({ error: 'ไม่พบหมวดหมู่นี้' });
    }
    return res.json({ message: 'ลบหมวดหมู่แล้ว' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' });
  }
});

// ----- API: ดึงค่าตั้งค่า (ยอดเงินตั้งต้น / งบประมาณ / แจ้งเตือน) -----
app.get('/api/settings', requireLogin, async (req, res) => {
  try {
    const settings = await db.getSettings(req.session.userId);
    return res.json({ settings });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' });
  }
});

// ----- API: อัปเดตค่าตั้งค่า -----
app.put('/api/settings', requireLogin, async (req, res) => {
  try {
    const { openingBalance, budget, notif, themeMode, themeAccent } = req.body;

    if (budget !== undefined && (isNaN(parseFloat(budget)) || parseFloat(budget) <= 0)) {
      return res.status(400).json({ error: 'งบประมาณไม่ถูกต้อง' });
    }
    if (openingBalance !== undefined && isNaN(parseFloat(openingBalance))) {
      return res.status(400).json({ error: 'ยอดเงินตั้งต้นไม่ถูกต้อง' });
    }
    if (themeMode !== undefined && !THEME_MODES.includes(themeMode)) {
      return res.status(400).json({ error: 'โหมดธีมไม่ถูกต้อง' });
    }
    if (themeAccent !== undefined && !(typeof themeAccent === 'string' && HEX_COLOR.test(themeAccent))) {
      return res.status(400).json({ error: 'สีธีมไม่ถูกต้อง' });
    }

    const settings = await db.updateSettings(req.session.userId, {
      openingBalance: openingBalance !== undefined ? parseFloat(openingBalance) : undefined,
      budget: budget !== undefined ? parseFloat(budget) : undefined,
      notif: notif !== undefined ? !!notif : undefined,
      themeMode,
      themeAccent: themeAccent !== undefined ? themeAccent.toUpperCase() : undefined
    });

    return res.json({ settings });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' });
  }
});

// ----- API: ดึงงบประมาณรายเดือนทั้งหมดที่เคยตั้งไว้ -----
app.get('/api/budgets', requireLogin, async (req, res) => {
  try {
    const budgets = await db.getBudgets(req.session.userId);
    return res.json({ budgets });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' });
  }
});

// ----- API: ตั้ง/แก้ไขงบประมาณของเดือนใดเดือนหนึ่ง -----
app.put('/api/budgets', requireLogin, async (req, res) => {
  try {
    const { year, month, budget } = req.body;
    const y = parseInt(year, 10);
    const m = parseInt(month, 10);
    const b = parseFloat(budget);

    if (isNaN(y) || isNaN(m) || m < 1 || m > 12) {
      return res.status(400).json({ error: 'ปี/เดือนไม่ถูกต้อง' });
    }
    if (isNaN(b) || b <= 0) {
      return res.status(400).json({ error: 'งบประมาณไม่ถูกต้อง' });
    }

    const row = await db.upsertBudget(req.session.userId, y, m, b);
    return res.json({ budget: row });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' });
  }
});

// ===================== แอดมิน =====================

// ----- API: สถิติภาพรวมสำหรับแดชบอร์ดแอดมิน -----
app.get('/api/admin/stats', requireAdmin, async (req, res) => {
  try {
    const days = 14;
    const [totals, growth, activity, categories] = await Promise.all([
      db.getPlatformTotals(),
      db.getUserGrowth(days),
      db.getDailyActivity(days),
      db.getCategoryBreakdownAll()
    ]);
    return res.json({ totals, growth, activity, categories });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' });
  }
});

// ----- API: ส่งอีเมลทดสอบไปที่อีเมลของแอดมิน เพื่อเช็คว่าตั้งค่าระบบส่งอีเมลถูกต้อง -----
app.post('/api/admin/test-email', requireAdmin, async (req, res) => {
  const problems = mailSetupProblems();
  if (problems.length > 0) {
    return res.status(400).json({
      error: `ยังไม่ได้ตั้งค่า environment variable: ${problems.join(', ')}`,
      hint: 'ใส่ค่าที่ขาดใน Render > Environment แล้วรอให้ deploy ใหม่เสร็จ (ดูตัวอย่างใน .env.example)'
    });
  }
  const to = req.currentUser.email;
  try {
    const sent = await sendMail({
      to,
      subject: 'ทดสอบส่งอีเมล — MoneyMate',
      text: 'ถ้าคุณได้รับอีเมลนี้ แปลว่าระบบส่งอีเมลของ MoneyMate (ลืมรหัสผ่าน) ตั้งค่าถูกต้องแล้ว',
      html: '<p style="font-family:Arial,sans-serif">ถ้าคุณได้รับอีเมลนี้ แปลว่าระบบส่งอีเมลของ <b>MoneyMate</b> (ลืมรหัสผ่าน) ตั้งค่าถูกต้องแล้ว</p>'
    });
    console.log(`[อีเมล] ส่งอีเมลทดสอบไปที่ ${maskEmail(to)} แล้ว (Brevo messageId: ${sent.messageId})`);
    return res.json({
      message: `Brevo รับอีเมลแล้ว กำลังส่งไปที่ ${to} — ถ้าไม่เห็นในกล่องจดหมายภายใน 2-3 นาที ให้เช็คโฟลเดอร์สแปม และหน้า Transactional > Logs ใน Brevo`,
      from: process.env.MAIL_FROM,
      appUrl: process.env.APP_URL,
      messageId: sent.messageId
    });
  } catch (err) {
    console.error(`[อีเมล] ส่งอีเมลทดสอบไม่สำเร็จ: ${err.message}`);
    return res.status(502).json({ error: err.message, hint: explainMailError(err) });
  }
});

// ----- API: รายชื่อผู้ใช้ทั้งหมด (สำหรับตารางจัดการยศ) -----
app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const users = await db.getAllUsers();
    return res.json({ users });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' });
  }
});

// ----- API: ตั้ง/ถอดยศแอดมินให้ผู้ใช้ -----
app.put('/api/admin/users/:id/role', requireAdmin, async (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    const { role } = req.body;

    if (isNaN(targetId)) {
      return res.status(400).json({ error: 'รหัสผู้ใช้ไม่ถูกต้อง' });
    }
    if (role !== 'admin' && role !== 'user') {
      return res.status(400).json({ error: 'ยศไม่ถูกต้อง (ต้องเป็น admin หรือ user เท่านั้น)' });
    }
    if (targetId === req.currentUser.id) {
      return res.status(400).json({ error: 'ไม่สามารถเปลี่ยนยศของตัวเองได้' });
    }
    if (role === 'user') {
      const adminCount = await db.countAdmins();
      const target = await db.findById(targetId);
      if (target && target.role === 'admin' && adminCount <= 1) {
        return res.status(400).json({ error: 'ต้องมีแอดมินเหลืออย่างน้อย 1 คนในระบบ' });
      }
    }

    const updated = await db.setUserRole(targetId, role);
    if (!updated) {
      return res.status(404).json({ error: 'ไม่พบผู้ใช้นี้' });
    }
    return res.json({ user: updated });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' });
  }
});

// ===================== แบบสอบถามความพึงพอใจ =====================

// ----- API: เช็คว่าผู้ใช้เคยตอบแบบสอบถาม หรือกด "ไม่ต้องแสดงอีก" ไว้หรือยัง -----
app.get('/api/survey/status', requireLogin, async (req, res) => {
  try {
    const status = await db.getSurveyStatus(req.session.userId);
    return res.json(status);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' });
  }
});

// ----- API: ส่งคำตอบแบบสอบถาม -----
app.post('/api/survey', requireLogin, async (req, res) => {
  try {
    const { yearLevel, answers, feedback } = req.body;

    if (!Array.isArray(answers) || answers.length !== 14) {
      return res.status(400).json({ error: 'กรุณาตอบคำถามให้ครบทุกข้อ' });
    }
    const cleanAnswers = answers.map(a => parseInt(a, 10));
    if (cleanAnswers.some(a => isNaN(a) || a < 1 || a > 5)) {
      return res.status(400).json({ error: 'คะแนนแต่ละข้อต้องอยู่ระหว่าง 1-5' });
    }

    const response = await db.submitSurveyResponse(req.session.userId, {
      yearLevel: (yearLevel || '').trim() || null,
      answers: cleanAnswers,
      feedback: (feedback || '').trim() || null
    });
    return res.status(201).json({ response });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' });
  }
});

// ----- API: ตั้งค่า "ไม่ต้องแสดงป๊อปอัปแบบสอบถามอีก" -----
app.put('/api/survey/dismiss', requireLogin, async (req, res) => {
  try {
    await db.dismissSurvey(req.session.userId);
    return res.json({ message: 'บันทึกแล้ว' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' });
  }
});

// ----- API: สถิติแบบสอบถามโดยรวม (ทุกคนที่ล็อคอินดูได้) -----
app.get('/api/survey/stats', requireLogin, async (req, res) => {
  try {
    const stats = await db.getSurveyStats();
    return res.json(stats);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'เกิดข้อผิดพลาดฝั่งเซิร์ฟเวอร์' });
  }
});

async function start() {
  if (!process.env.DATABASE_URL) {
    console.error('ไม่พบ DATABASE_URL — กรุณาตั้งค่าใน .env (ดูวิธีใน README.md)');
    process.exit(1);
  }
  await db.init();
  app.listen(PORT, () => {
    console.log(`เซิร์ฟเวอร์กำลังทำงานที่ http://localhost:${PORT}`);
    const problems = mailSetupProblems();
    if (problems.length > 0) {
      console.warn(`[อีเมล] ยังตั้งค่าไม่ครบ: ${problems.join(', ')} — ลืมรหัสผ่านจะใช้ได้เฉพาะตอนทดสอบบน localhost (ลิงก์จะแสดงใน console)`);
    } else if (apiKeyProblem()) {
      console.warn(`[อีเมล] ${apiKeyProblem()}`);
    } else {
      console.log(`[อีเมล] พร้อมส่งผ่าน Brevo (ผู้ส่ง: ${process.env.MAIL_FROM}, ลิงก์ชี้ไปที่ ${process.env.APP_URL})`);
    }
    console.log(ai.enabled()
      ? `[AI] เปิดใช้ Gemini (จำกัด ${ai.dailyLimit()} ครั้ง/คน/วัน)`
      : '[AI] ปิดอยู่ — ตั้งค่า GEMINI_API_KEY เพื่อเปิดผู้ช่วย AI');
  });
}

start();
