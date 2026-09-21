// server.js
// เซิร์ฟเวอร์หลักของระบบล็อคอิน (Express + PostgreSQL + Session)
require('dotenv').config();

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const db = require('./database');
const { sendMail, isMailConfigured } = require('./mailer');

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

  // ลิงก์ต้องชี้ไปที่เว็บของเราเสมอ ตอนใช้งานจริงจึงต้องตั้ง APP_URL (ไม่เชื่อ Host header ที่ส่งมา)
  const baseUrl = process.env.APP_URL || (isProduction ? '' : `${req.protocol}://${req.get('host')}`);
  if (isProduction && (!isMailConfigured() || !baseUrl)) {
    console.error('ระบบลืมรหัสผ่านยังไม่พร้อม: ต้องตั้งค่า BREVO_API_KEY, MAIL_FROM และ APP_URL');
    return res.status(503).json({ error: 'ระบบส่งอีเมลยังไม่พร้อมใช้งาน กรุณาติดต่อผู้ดูแลระบบ' });
  }

  // ตอบข้อความเดียวกันเสมอ และตอบก่อนส่งอีเมล เพื่อไม่ให้ใครใช้หน้านี้เช็คได้ว่าอีเมลไหนมีบัญชี
  res.json({ message: 'ถ้าอีเมลนี้มีบัญชีอยู่ในระบบ เราได้ส่งลิงก์ตั้งรหัสผ่านใหม่ไปให้แล้ว กรุณาตรวจสอบกล่องจดหมาย (รวมถึงโฟลเดอร์สแปม)' });

  try {
    const user = await db.findByEmail(email);
    if (!user) return;

    const token = crypto.randomBytes(32).toString('hex');
    await db.createPasswordReset(user.id, hashToken(token), new Date(Date.now() + RESET_TOKEN_TTL_MS));
    const link = `${baseUrl.replace(/\/+$/, '')}/reset-password.html?token=${token}`;

    await sendMail({
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
  } catch (err) {
    console.error('ส่งลิงก์ตั้งรหัสผ่านใหม่ไม่สำเร็จ:', err);
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

// ----- API: ดึงข้อมูลผู้ใช้ที่ล็อคอินอยู่ -----
app.get('/api/me', requireLogin, async (req, res) => {
  try {
    const user = await db.findById(req.session.userId);
    if (!user) {
      return res.status(401).json({ error: 'ไม่พบผู้ใช้นี้ในระบบ' });
    }
    const { password_hash, ...safeUser } = user;
    return res.json({ user: safeUser });
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
  });
}

start();
