// database.js
// เก็บข้อมูลผู้ใช้ใน PostgreSQL (ฐานข้อมูลถาวร แยกอยู่นอกตัวเซิร์ฟเวอร์)
// อ่าน connection string จาก environment variable DATABASE_URL
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // จำเป็นสำหรับ Neon/Render Postgres ส่วนใหญ่
});

// สร้างตาราง users ถ้ายังไม่มี (รันตอนเซิร์ฟเวอร์เริ่มทำงาน)
async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  // ตารางรายการรายรับ-รายจ่าย ผูกกับผู้ใช้แต่ละคน (ทำให้ข้อมูลไม่หายเวลารีเฟรช)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  // เผื่อกรณีตาราง transactions มีอยู่ก่อนแล้วแต่คอลัมน์ไม่ครบ (เช่นจากการทดลองครั้งก่อน)
  // ใช้ ADD COLUMN IF NOT EXISTS เติมคอลัมน์ที่ขาดโดยไม่ลบข้อมูลเดิม
  await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS type TEXT`);
  await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS cat TEXT NOT NULL DEFAULT 'other'`);
  await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS title TEXT`);
  await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS amount NUMERIC(12,2)`);
  await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS tx_date TIMESTAMPTZ`);
  await pool.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id)
  `);

  // ตารางค่าตั้งค่าต่อผู้ใช้ (ยอดเงินตั้งต้น, งบประมาณ, การแจ้งเตือน)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await pool.query(`ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS opening_balance NUMERIC(12,2) NOT NULL DEFAULT 0`);
  await pool.query(`ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS budget NUMERIC(12,2) NOT NULL DEFAULT 6000`);
  await pool.query(`ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS notif BOOLEAN NOT NULL DEFAULT TRUE`);
}

// ตรวจสอบว่ามี username หรือ email นี้ในระบบแล้วหรือยัง
async function userExists(username, email) {
  const { rows } = await pool.query(
    'SELECT id FROM users WHERE username = $1 OR email = $2',
    [username, email]
  );
  return rows.length > 0;
}

// หาผู้ใช้จาก username หรือ email (ใช้ตอนล็อคอิน)
async function findByLogin(usernameOrEmail) {
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE username = $1 OR email = $1',
    [usernameOrEmail]
  );
  return rows[0] || null;
}

// หาผู้ใช้จาก id (ใช้ตอนเช็คเซสชัน)
async function findById(id) {
  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
  return rows[0] || null;
}

// สร้างผู้ใช้ใหม่
async function createUser({ username, email, passwordHash }) {
  const { rows } = await pool.query(
    'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING *',
    [username, email, passwordHash]
  );
  return rows[0];
}

// ----- รายการรายรับ-รายจ่าย -----

// ดึงรายการทั้งหมดของผู้ใช้ (เรียงล่าสุดก่อน)
async function getTransactions(userId) {
  const { rows } = await pool.query(
    'SELECT * FROM transactions WHERE user_id = $1 ORDER BY tx_date DESC, id DESC',
    [userId]
  );
  return rows;
}

// เพิ่มรายการใหม่
async function createTransaction({ userId, type, cat, title, amount, date }) {
  const { rows } = await pool.query(
    `INSERT INTO transactions (user_id, type, cat, title, amount, tx_date)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [userId, type, cat, title, amount, date]
  );
  return rows[0];
}

// ลบรายการ (เฉพาะของผู้ใช้ที่เป็นเจ้าของเท่านั้น)
async function deleteTransaction(id, userId) {
  const { rows } = await pool.query(
    'DELETE FROM transactions WHERE id = $1 AND user_id = $2 RETURNING id',
    [id, userId]
  );
  return rows.length > 0;
}

// ----- ค่าตั้งค่าต่อผู้ใช้ (ยอดเงินตั้งต้น / งบประมาณ / แจ้งเตือน) -----

// ดึงค่าตั้งค่า ถ้ายังไม่มีให้สร้างค่าเริ่มต้นให้อัตโนมัติ
async function getSettings(userId) {
  const { rows } = await pool.query('SELECT * FROM user_settings WHERE user_id = $1', [userId]);
  if (rows.length > 0) return rows[0];

  const inserted = await pool.query(
    `INSERT INTO user_settings (user_id, opening_balance, budget, notif)
     VALUES ($1, 5000, 6000, true)
     ON CONFLICT (user_id) DO UPDATE SET user_id = EXCLUDED.user_id
     RETURNING *`,
    [userId]
  );
  return inserted.rows[0];
}

// อัปเดตค่าตั้งค่า (ส่งเฉพาะฟิลด์ที่ต้องการเปลี่ยนได้ ที่เหลือคงค่าเดิม)
async function updateSettings(userId, { openingBalance, budget, notif }) {
  const current = await getSettings(userId);
  const newOpening = openingBalance !== undefined ? openingBalance : current.opening_balance;
  const newBudget = budget !== undefined ? budget : current.budget;
  const newNotif = notif !== undefined ? notif : current.notif;

  const { rows } = await pool.query(
    `UPDATE user_settings SET opening_balance = $2, budget = $3, notif = $4
     WHERE user_id = $1 RETURNING *`,
    [userId, newOpening, newBudget, newNotif]
  );
  return rows[0];
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
