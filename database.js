// database.js
// MoneyMate - PostgreSQL database (Neon / Render)

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// สร้างตารางที่ระบบต้องใช้
async function init() {
  // ตารางผู้ใช้
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // ตารางรายรับ/รายจ่าย
  await pool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      cat TEXT NOT NULL DEFAULT 'other',
      title TEXT DEFAULT '',
      amount NUMERIC(12,2) NOT NULL,
      date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // ตารางการตั้งค่าของแต่ละบัญชี
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      opening_balance NUMERIC(12,2) NOT NULL DEFAULT 5000,
      budget NUMERIC(12,2) NOT NULL DEFAULT 6000,
      notif BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  console.log('Database initialized successfully');
}

// ตรวจสอบว่ามี username หรือ email นี้แล้วหรือไม่
async function userExists(username, email) {
  const { rows } = await pool.query(
    'SELECT id FROM users WHERE username = $1 OR email = $2',
    [username, email]
  );
  return rows.length > 0;
}

// หา user ตอนล็อกอิน
async function findByLogin(usernameOrEmail) {
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE username = $1 OR email = $1',
    [usernameOrEmail]
  );
  return rows[0] || null;
}

// หา user จาก id
async function findById(id) {
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE id = $1',
    [id]
  );
  return rows[0] || null;
}

// สร้าง user
async function createUser({ username, email, passwordHash }) {
  const { rows } = await pool.query(
    `INSERT INTO users (username, email, password_hash)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [username, email, passwordHash]
  );

  const user = rows[0];

  // สร้างค่าตั้งต้นให้ user ใหม่
  await pool.query(
    `INSERT INTO user_settings (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [user.id]
  );

  return user;
}

// ดึงรายการของ user ที่ล็อกอินอยู่
async function getTransactions(userId) {
  const { rows } = await pool.query(
    `SELECT id, type, cat, title, amount, date
     FROM transactions
     WHERE user_id = $1
     ORDER BY date DESC, id DESC`,
    [userId]
  );

  return rows.map(row => ({
    id: row.id,
    type: row.type,
    cat: row.cat,
    title: row.title,
    amount: Number(row.amount),
    date: row.date
  }));
}

// เพิ่มรายการรายรับ/รายจ่าย
async function createTransaction({
  userId,
  type,
  cat,
  title,
  amount,
  date
}) {
  const { rows } = await pool.query(
    `INSERT INTO transactions
       (user_id, type, cat, title, amount, date)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, type, cat, title, amount, date`,
    [userId, type, cat || 'other', title || '', amount, date]
  );

  const row = rows[0];

  return {
    id: row.id,
    type: row.type,
    cat: row.cat,
    title: row.title,
    amount: Number(row.amount),
    date: row.date
  };
}

// ลบรายการ โดยลบได้เฉพาะรายการของ user คนนั้น
async function deleteTransaction(id, userId) {
  const result = await pool.query(
    `DELETE FROM transactions
     WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );

  return result.rowCount > 0;
}

// ดึงค่าตั้งค่าของ user
async function getSettings(userId) {
  await pool.query(
    `INSERT INTO user_settings (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );

  const { rows } = await pool.query(
    `SELECT opening_balance, budget, notif
     FROM user_settings
     WHERE user_id = $1`,
    [userId]
  );

  const row = rows[0];

  return {
    openingBalance: Number(row.opening_balance),
    budget: Number(row.budget),
    notif: Boolean(row.notif)
  };
}

// อัปเดตค่าตั้งค่า
async function updateSettings(userId, {
  openingBalance,
  budget,
  notif
}) {
  await pool.query(
    `INSERT INTO user_settings
       (user_id, opening_balance, budget, notif)
     VALUES (
       $1,
       COALESCE($2, 5000),
       COALESCE($3, 6000),
       COALESCE($4, TRUE)
     )
     ON CONFLICT (user_id)
     DO UPDATE SET
       opening_balance = COALESCE($2, user_settings.opening_balance),
       budget = COALESCE($3, user_settings.budget),
       notif = COALESCE($4, user_settings.notif),
       updated_at = NOW()`,
    [
      userId,
      openingBalance ?? null,
      budget ?? null,
      notif ?? null
    ]
  );

  return getSettings(userId);
}

module.exports = {
  init,
  userExists,
  findByLogin,
  findById,
  createUser,
  getTransactions,
  createTransaction,
  deleteTransaction,
  getSettings,
  updateSettings
};
