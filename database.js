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
  // เพิ่มคอลัมน์ role ให้ตาราง users ที่มีอยู่แล้ว (ผู้ใช้ทั่วไป = 'user', แอดมิน = 'admin')
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user'`);

  // ตารางรายการรายรับ-รายจ่าย ผูกกับผู้ใช้แต่ละคน (ทำให้ข้อมูลไม่หายเวลารีเฟรช)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
      cat TEXT NOT NULL DEFAULT 'other',
      title TEXT,
      amount NUMERIC(12,2) NOT NULL,
      tx_date TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_transactions_user_id ON transactions(user_id)
  `);

  // ตารางค่าตั้งค่าต่อผู้ใช้ (ยอดเงินตั้งต้น, งบประมาณ, การแจ้งเตือน)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      opening_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
      budget NUMERIC(12,2) NOT NULL DEFAULT 6000,
      notif BOOLEAN NOT NULL DEFAULT TRUE
    )
  `);

  // ตารางงบประมาณรายเดือน (ผู้ใช้กำหนดงบของแต่ละเดือนแยกกันได้)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS monthly_budgets (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      year INTEGER NOT NULL,
      month INTEGER NOT NULL,
      budget NUMERIC(12,2) NOT NULL,
      UNIQUE(user_id, year, month)
    )
  `);

  // แฟล็กบอกว่าผู้ใช้กด "ไม่ต้องแสดงอีก" สำหรับป๊อปอัปแบบสอบถามหรือยัง
  await pool.query(`ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS survey_dismissed BOOLEAN NOT NULL DEFAULT FALSE`);

  // ตารางคำตอบแบบสอบถามความพึงพอใจ (14 ข้อให้คะแนน 1-5 + ชั้นปี + ข้อเสนอแนะปลายเปิด)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS survey_responses (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      year_level TEXT,
      q1 SMALLINT, q2 SMALLINT, q3 SMALLINT, q4 SMALLINT, q5 SMALLINT, q6 SMALLINT, q7 SMALLINT,
      q8 SMALLINT, q9 SMALLINT, q10 SMALLINT, q11 SMALLINT, q12 SMALLINT, q13 SMALLINT, q14 SMALLINT,
      feedback TEXT,
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
     VALUES ($1, 0, 6000, true)
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

// ----- งบประมาณรายเดือน -----

// ดึงงบประมาณที่ผู้ใช้ตั้งไว้เป็นรายเดือนทั้งหมด (เฉพาะเดือนที่เคยตั้งค่าไว้)
async function getBudgets(userId) {
  const { rows } = await pool.query(
    'SELECT year, month, budget FROM monthly_budgets WHERE user_id = $1',
    [userId]
  );
  return rows;
}

// ตั้ง/แก้ไขงบประมาณของเดือนใดเดือนหนึ่งโดยเฉพาะ (upsert)
// พร้อมอัปเดต user_settings.budget ให้เป็นค่าล่าสุดด้วย เพื่อใช้เป็นค่าเริ่มต้นของเดือนถัดๆ ไปที่ยังไม่เคยตั้งค่า
async function upsertBudget(userId, year, month, budget) {
  const { rows } = await pool.query(
    `INSERT INTO monthly_budgets (user_id, year, month, budget)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, year, month) DO UPDATE SET budget = EXCLUDED.budget
     RETURNING *`,
    [userId, year, month, budget]
  );
  await updateSettings(userId, { budget });
  return rows[0];
}

// ----- แอดมิน: จัดการผู้ใช้และสถิติภาพรวมระบบ -----

// ดึงรายชื่อผู้ใช้ทั้งหมด (สำหรับตารางจัดการยศในหน้าแอดมิน)
async function getAllUsers() {
  const { rows } = await pool.query(
    `SELECT id, username, email, role, created_at,
       (SELECT COUNT(*) FROM transactions t WHERE t.user_id = users.id) AS tx_count
     FROM users ORDER BY created_at DESC`
  );
  return rows;
}

// ตั้งยศผู้ใช้ ('user' หรือ 'admin')
async function setUserRole(userId, role) {
  const { rows } = await pool.query(
    `UPDATE users SET role = $2 WHERE id = $1 RETURNING id, username, email, role`,
    [userId, role]
  );
  return rows[0] || null;
}

// นับจำนวนแอดมินทั้งหมด (ใช้กันไม่ให้ลดยศแอดมินคนสุดท้ายจนไม่เหลือใครดูแลระบบ)
async function countAdmins() {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS count FROM users WHERE role = 'admin'`);
  return rows[0].count;
}

// ตัวเลขสรุปภาพรวมทั้งระบบ
async function getPlatformTotals() {
  const { rows } = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM users)::int AS total_users,
      (SELECT COUNT(*) FROM users WHERE role = 'admin')::int AS total_admins,
      (SELECT COUNT(*) FROM transactions)::int AS total_transactions,
      (SELECT COALESCE(SUM(amount),0) FROM transactions WHERE type = 'income') AS total_income,
      (SELECT COALESCE(SUM(amount),0) FROM transactions WHERE type = 'expense') AS total_expense
  `);
  return rows[0];
}

// จำนวนผู้ใช้สมัครใหม่ต่อวัน ย้อนหลัง N วัน (เติมวันที่ไม่มีข้อมูลด้วย 0 ให้กราฟต่อเนื่อง)
async function getUserGrowth(days) {
  const { rows } = await pool.query(
    `SELECT gs::date AS day, COUNT(u.id)::int AS count
     FROM generate_series(CURRENT_DATE - ($1::int - 1), CURRENT_DATE, interval '1 day') AS gs
     LEFT JOIN users u ON u.created_at::date = gs::date
     GROUP BY gs ORDER BY gs`,
    [days]
  );
  return rows;
}

// กิจกรรมรายวัน (จำนวนรายการ + ยอดรวม) ย้อนหลัง N วัน ทั้งระบบ
async function getDailyActivity(days) {
  const { rows } = await pool.query(
    `SELECT gs::date AS day,
       COUNT(t.id)::int AS count,
       COALESCE(SUM(CASE WHEN t.type = 'expense' THEN t.amount ELSE 0 END),0) AS expense_total,
       COALESCE(SUM(CASE WHEN t.type = 'income' THEN t.amount ELSE 0 END),0) AS income_total
     FROM generate_series(CURRENT_DATE - ($1::int - 1), CURRENT_DATE, interval '1 day') AS gs
     LEFT JOIN transactions t ON t.tx_date::date = gs::date
     GROUP BY gs ORDER BY gs`,
    [days]
  );
  return rows;
}

// สัดส่วนรายจ่ายตามหมวดหมู่ รวมทุกผู้ใช้ในระบบ
async function getCategoryBreakdownAll() {
  const { rows } = await pool.query(
    `SELECT cat, COUNT(*)::int AS count, COALESCE(SUM(amount),0) AS total
     FROM transactions WHERE type = 'expense'
     GROUP BY cat ORDER BY total DESC`
  );
  return rows;
}

// ----- แบบสอบถามความพึงพอใจ -----

// เช็คสถานะแบบสอบถามของผู้ใช้คนนี้: เคยตอบหรือยัง / กด "ไม่ต้องแสดงอีก" ไว้หรือเปล่า
async function getSurveyStatus(userId) {
  const settings = await getSettings(userId); // เผื่อยังไม่มีแถวใน user_settings ให้สร้างให้ก่อน
  const { rows } = await pool.query(
    'SELECT id FROM survey_responses WHERE user_id = $1 LIMIT 1',
    [userId]
  );
  return { hasResponded: rows.length > 0, dismissed: !!settings.survey_dismissed };
}

// บันทึกคำตอบแบบสอบถาม (answers เป็น array ตัวเลข 1-5 จำนวน 14 ข้อ)
async function submitSurveyResponse(userId, { yearLevel, answers, feedback }) {
  const cols = answers.map((_, i) => `q${i + 1}`).join(', ');
  const placeholders = answers.map((_, i) => `$${i + 3}`).join(', ');
  const { rows } = await pool.query(
    `INSERT INTO survey_responses (user_id, year_level, ${cols}, feedback)
     VALUES ($1, $2, ${placeholders}, $${answers.length + 3})
     RETURNING *`,
    [userId, yearLevel, ...answers, feedback]
  );
  return rows[0];
}

// ตั้งค่า "ไม่ต้องแสดงป๊อปอัปแบบสอบถามอีก" ให้ผู้ใช้คนนี้
async function dismissSurvey(userId) {
  await getSettings(userId);
  await pool.query('UPDATE user_settings SET survey_dismissed = true WHERE user_id = $1', [userId]);
}

// สถิติรวมของแบบสอบถามทั้งหมด (สำหรับแดชบอร์ดที่ทุกคนดูได้)
async function getSurveyStats() {
  const { rows: totalRows } = await pool.query('SELECT COUNT(*)::int AS count FROM survey_responses');
  const total = totalRows[0].count;

  const avgCols = Array.from({ length: 14 }, (_, i) => `AVG(q${i + 1})::float AS avg_q${i + 1}`).join(', ');
  const { rows: avgRows } = total > 0
    ? await pool.query(`SELECT ${avgCols} FROM survey_responses`)
    : [{}];
  const averages = avgRows[0] || {};

  const { rows: yearLevels } = await pool.query(`
    SELECT year_level, COUNT(*)::int AS count FROM survey_responses
    WHERE year_level IS NOT NULL AND year_level <> ''
    GROUP BY year_level ORDER BY year_level
  `);

  const { rows: overallDist } = await pool.query(`
    SELECT q14 AS rating, COUNT(*)::int AS count FROM survey_responses
    WHERE q14 IS NOT NULL GROUP BY q14 ORDER BY q14
  `);

  const { rows: feedback } = await pool.query(`
    SELECT feedback, created_at FROM survey_responses
    WHERE feedback IS NOT NULL AND TRIM(feedback) <> '' AND feedback <> '-'
    ORDER BY created_at DESC LIMIT 12
  `);

  // แนวโน้มจำนวนคนตอบแบบสอบถามย้อนหลัง 14 วัน (เติมวันที่ไม่มีข้อมูลด้วย 0 ให้กราฟต่อเนื่อง)
  const { rows: trend } = await pool.query(`
    SELECT gs::date AS day, COUNT(s.id)::int AS count
    FROM generate_series(CURRENT_DATE - 13, CURRENT_DATE, interval '1 day') AS gs
    LEFT JOIN survey_responses s ON s.created_at::date = gs::date
    GROUP BY gs ORDER BY gs
  `);

  return { total, averages, yearLevels, overallDist, feedback, trend };
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
  updateSettings,
  getBudgets,
  upsertBudget,
  getAllUsers,
  setUserRole,
  countAdmins,
  getPlatformTotals,
  getUserGrowth,
  getDailyActivity,
  getCategoryBreakdownAll,
  getSurveyStatus,
  submitSurveyResponse,
  dismissSurvey,
  getSurveyStats
};
