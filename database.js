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

module.exports = { init, userExists, findByLogin, findById, createUser };
