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

  // ล็อกอินด้วย Google: google_id คือรหัสบัญชี Google (sub) ที่เชื่อมไว้
  // บัญชีที่สมัครผ่าน Google อย่างเดียวจะไม่มีรหัสผ่าน (password_hash เป็น NULL)
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id TEXT UNIQUE`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_email TEXT`);
  await pool.query(`ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL`);

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

  // ธีมที่ผู้ใช้เลือก: โหมด (dark / light / system) และสีหลักของหน้าเว็บ
  await pool.query(`ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS theme_mode TEXT NOT NULL DEFAULT 'dark'`);
  await pool.query(`ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS theme_accent TEXT NOT NULL DEFAULT '#2FBF8F'`);

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

  // ตารางหมวดหมู่ที่ผู้ใช้สร้างเอง (นอกเหนือจากหมวดหมู่มาตรฐาน) แยกตามประเภทรายรับ/รายจ่าย
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_categories (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL DEFAULT 'expense' CHECK (type IN ('income', 'expense')),
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // ฐานข้อมูลที่สร้างไว้ก่อนมีหมวดรายรับ: เพิ่มคอลัมน์ type และให้ชื่อซ้ำกันได้ถ้าคนละประเภท
  await pool.query(`ALTER TABLE user_categories ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'expense' CHECK (type IN ('income', 'expense'))`);
  await pool.query(`ALTER TABLE user_categories DROP CONSTRAINT IF EXISTS user_categories_user_id_name_key`);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_categories_user_type_name ON user_categories(user_id, type, name)
  `);

  // แผนการเงินล่วงหน้า: รายรับ/รายจ่ายที่คาดไว้ (ทุกวัน / ทุกสัปดาห์ / ทุกเดือน / ครั้งเดียว)
  //   day     = วันที่ของเดือน (1-31) สำหรับรายเดือน หรือวันในสัปดาห์ (0 = อาทิตย์) สำหรับรายสัปดาห์
  //   on_date = วันที่ 'YYYY-MM-DD' สำหรับรายการครั้งเดียว (เก็บเป็นข้อความ ไม่ให้เลื่อนตามเขตเวลา)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS plan_items (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('income', 'expense')),
      name TEXT NOT NULL,
      amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
      freq TEXT NOT NULL CHECK (freq IN ('daily', 'weekly', 'monthly', 'once')),
      day INTEGER,
      on_date TEXT,
      cat TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_plan_items_user ON plan_items(user_id)`);

  // โทเค็นรีเซ็ตรหัสผ่าน (เก็บเฉพาะค่า hash ของโทเค็น ไม่เก็บตัวจริง)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_resets (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT UNIQUE NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
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

// ----- ล็อกอินด้วย Google -----

async function findByGoogleId(googleId) {
  const { rows } = await pool.query('SELECT * FROM users WHERE google_id = $1', [googleId]);
  return rows[0] || null;
}

async function usernameTaken(username) {
  const { rows } = await pool.query('SELECT 1 FROM users WHERE LOWER(username) = LOWER($1)', [username]);
  return rows.length > 0;
}

// สร้างบัญชีใหม่จากบัญชี Google (ไม่มีรหัสผ่าน)
async function createGoogleUser({ username, email, googleId }) {
  const { rows } = await pool.query(
    `INSERT INTO users (username, email, password_hash, google_id, google_email)
     VALUES ($1, $2, NULL, $3, $2) RETURNING *`,
    [username, email, googleId]
  );
  return rows[0];
}

// เชื่อม / ยกเลิกการเชื่อมบัญชี Google กับบัญชีที่มีอยู่
async function linkGoogle(userId, googleId, googleEmail) {
  await pool.query('UPDATE users SET google_id = $2, google_email = $3 WHERE id = $1', [userId, googleId, googleEmail]);
}

async function unlinkGoogle(userId) {
  await pool.query('UPDATE users SET google_id = NULL, google_email = NULL WHERE id = $1', [userId]);
}

// หาผู้ใช้จากอีเมล (ไม่สนตัวพิมพ์เล็ก/ใหญ่) ใช้ตอนขอรีเซ็ตรหัสผ่าน
async function findByEmail(email) {
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE LOWER(email) = LOWER($1)',
    [email]
  );
  return rows[0] || null;
}

// ----- รีเซ็ตรหัสผ่าน -----

// สร้างโทเค็นใหม่ (ลบโทเค็นเก่าของผู้ใช้คนนี้ทิ้ง ให้ใช้ได้แค่ลิงก์ล่าสุด)
async function createPasswordReset(userId, tokenHash, expiresAt) {
  await pool.query('DELETE FROM password_resets WHERE user_id = $1', [userId]);
  await pool.query(
    'INSERT INTO password_resets (user_id, token_hash, expires_at) VALUES ($1, $2, $3)',
    [userId, tokenHash, expiresAt]
  );
}

// หาโทเค็นที่ยังไม่หมดอายุ
async function findValidPasswordReset(tokenHash) {
  const { rows } = await pool.query(
    'SELECT * FROM password_resets WHERE token_hash = $1 AND expires_at > NOW()',
    [tokenHash]
  );
  return rows[0] || null;
}

// ตั้งรหัสผ่านใหม่และลบโทเค็นทิ้ง (ทำใน transaction เดียว ลิงก์จึงใช้ได้ครั้งเดียว)
async function resetPassword(tokenHash, passwordHash) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      'DELETE FROM password_resets WHERE token_hash = $1 AND expires_at > NOW() RETURNING user_id',
      [tokenHash]
    );
    if (rows.length === 0) {
      await client.query('ROLLBACK');
      return false;
    }
    const userId = rows[0].user_id;
    await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);
    await client.query('DELETE FROM password_resets WHERE user_id = $1', [userId]);
    await client.query('COMMIT');
    return true;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
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

// เพิ่มหลายรายการในคำสั่งเดียว (ใช้กับสคริปต์สร้างบัญชีตัวอย่าง — เร็วกว่าเพิ่มทีละรายการมาก)
async function createTransactionsBulk(userId, txs) {
  const CHUNK = 500; // 500 แถว x 6 ค่า = 3,000 พารามิเตอร์ต่อคำสั่ง
  for (let i = 0; i < txs.length; i += CHUNK) {
    const part = txs.slice(i, i + CHUNK);
    const params = [];
    const values = part.map((t, j) => {
      const b = j * 6;
      params.push(userId, t.type, t.cat, t.title, t.amount, t.date);
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6})`;
    });
    await pool.query(
      `INSERT INTO transactions (user_id, type, cat, title, amount, tx_date) VALUES ${values.join(', ')}`,
      params
    );
  }
}

// ลบบัญชี (ข้อมูลทุกตารางที่ผูกกับผู้ใช้ถูกลบตามด้วย ON DELETE CASCADE)
async function deleteUser(id) {
  await pool.query('DELETE FROM users WHERE id = $1', [id]);
}

// ปิดการเชื่อมต่อฐานข้อมูล (ใช้ตอนสคริปต์ทำงานเสร็จ)
async function close() {
  await pool.end();
}

// ลบรายการ (เฉพาะของผู้ใช้ที่เป็นเจ้าของเท่านั้น)
async function deleteTransaction(id, userId) {
  const { rows } = await pool.query(
    'DELETE FROM transactions WHERE id = $1 AND user_id = $2 RETURNING id',
    [id, userId]
  );
  return rows.length > 0;
}

// ----- หมวดหมู่ที่ผู้ใช้สร้างเอง -----

// ดึงหมวดหมู่ที่ผู้ใช้สร้างไว้ทั้งรายรับและรายจ่าย (เรียงตามลำดับที่สร้าง)
async function getCategories(userId) {
  const { rows } = await pool.query(
    'SELECT id, type, name FROM user_categories WHERE user_id = $1 ORDER BY id',
    [userId]
  );
  return rows;
}

// เพิ่มหมวดหมู่ใหม่ (ถ้ามีชื่อนี้ในประเภทเดียวกันอยู่แล้วจะคืนค่าตัวเดิม)
async function createCategory(userId, type, name) {
  const { rows } = await pool.query(
    `INSERT INTO user_categories (user_id, type, name) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, type, name) DO UPDATE SET name = EXCLUDED.name
     RETURNING id, type, name`,
    [userId, type, name]
  );
  return rows[0];
}

// ลบหมวดหมู่ (รายการที่เคยบันทึกด้วยหมวดนี้ยังอยู่ครบ)
async function deleteCategory(id, userId) {
  const { rows } = await pool.query(
    'DELETE FROM user_categories WHERE id = $1 AND user_id = $2 RETURNING id',
    [id, userId]
  );
  return rows.length > 0;
}

// ----- แผนการเงินล่วงหน้า -----

const PLAN_COLUMNS = 'id, type, name, amount, freq, day, on_date, cat';

async function getPlanItems(userId) {
  const { rows } = await pool.query(
    `SELECT ${PLAN_COLUMNS} FROM plan_items WHERE user_id = $1 ORDER BY id`,
    [userId]
  );
  return rows;
}

async function countPlanItems(userId) {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM plan_items WHERE user_id = $1', [userId]);
  return rows[0].n;
}

async function createPlanItem(userId, p) {
  const { rows } = await pool.query(
    `INSERT INTO plan_items (user_id, type, name, amount, freq, day, on_date, cat)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING ${PLAN_COLUMNS}`,
    [userId, p.type, p.name, p.amount, p.freq, p.day, p.onDate, p.cat]
  );
  return rows[0];
}

// แก้ไขได้เฉพาะรายการของผู้ใช้คนนั้น — คืน null ถ้าไม่พบ
async function updatePlanItem(id, userId, p) {
  const { rows } = await pool.query(
    `UPDATE plan_items SET type = $3, name = $4, amount = $5, freq = $6, day = $7, on_date = $8, cat = $9
     WHERE id = $1 AND user_id = $2
     RETURNING ${PLAN_COLUMNS}`,
    [id, userId, p.type, p.name, p.amount, p.freq, p.day, p.onDate, p.cat]
  );
  return rows[0] || null;
}

async function deletePlanItem(id, userId) {
  const { rows } = await pool.query(
    'DELETE FROM plan_items WHERE id = $1 AND user_id = $2 RETURNING id',
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
async function updateSettings(userId, { openingBalance, budget, notif, themeMode, themeAccent }) {
  const current = await getSettings(userId);
  const newOpening = openingBalance !== undefined ? openingBalance : current.opening_balance;
  const newBudget = budget !== undefined ? budget : current.budget;
  const newNotif = notif !== undefined ? notif : current.notif;
  const newThemeMode = themeMode !== undefined ? themeMode : current.theme_mode;
  const newThemeAccent = themeAccent !== undefined ? themeAccent : current.theme_accent;

  const { rows } = await pool.query(
    `UPDATE user_settings SET opening_balance = $2, budget = $3, notif = $4, theme_mode = $5, theme_accent = $6
     WHERE user_id = $1 RETURNING *`,
    [userId, newOpening, newBudget, newNotif, newThemeMode, newThemeAccent]
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
  close,
  deleteUser,
  createTransactionsBulk,
  userExists,
  findByLogin,
  findById,
  createUser,
  findByGoogleId,
  usernameTaken,
  createGoogleUser,
  linkGoogle,
  unlinkGoogle,
  findByEmail,
  createPasswordReset,
  findValidPasswordReset,
  resetPassword,
  getTransactions,
  createTransaction,
  deleteTransaction,
  getCategories,
  createCategory,
  deleteCategory,
  getPlanItems,
  countPlanItems,
  createPlanItem,
  updatePlanItem,
  deletePlanItem,
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
