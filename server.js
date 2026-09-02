// server.js
// เซิร์ฟเวอร์หลักของระบบล็อคอิน (Express + PostgreSQL + Session)
require('dotenv').config();

const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const isProduction = process.env.NODE_ENV === 'production';

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

// เสิร์ฟไฟล์หน้าเว็บ (HTML/CSS/JS) จากโฟลเดอร์ public
app.use(express.static(path.join(__dirname, 'public')));

// ----- Middleware ตรวจสอบว่าล็อคอินอยู่หรือไม่ -----
function requireLogin(req, res, next) {
  if (req.session && req.session.userId) {
    return next();
  }
  return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบก่อน' });
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

    const transaction = await db.createTransaction({
      userId: req.session.userId,
      type,
      cat: type === 'income' ? 'income' : (cat || 'other'),
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
    const { openingBalance, budget, notif } = req.body;

    if (budget !== undefined && (isNaN(parseFloat(budget)) || parseFloat(budget) <= 0)) {
      return res.status(400).json({ error: 'งบประมาณไม่ถูกต้อง' });
    }
    if (openingBalance !== undefined && isNaN(parseFloat(openingBalance))) {
      return res.status(400).json({ error: 'ยอดเงินตั้งต้นไม่ถูกต้อง' });
    }

    const settings = await db.updateSettings(req.session.userId, {
      openingBalance: openingBalance !== undefined ? parseFloat(openingBalance) : undefined,
      budget: budget !== undefined ? parseFloat(budget) : undefined,
      notif: notif !== undefined ? !!notif : undefined
    });

    return res.json({ settings });
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
