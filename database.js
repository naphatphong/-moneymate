const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      cat TEXT NOT NULL,
      title TEXT,
      amount NUMERIC(12,2) NOT NULL,
      date TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      opening_balance NUMERIC(12,2) NOT NULL DEFAULT 5000,
      budget NUMERIC(12,2) NOT NULL DEFAULT 6000,
      notif BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

async function userExists(username, email) {
  const { rows } = await pool.query(
    'SELECT id FROM users WHERE username = $1 OR email = $2',
    [username, email]
  );
  return rows.length > 0;
}

async function findByLogin(usernameOrEmail) {
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE username = $1 OR email = $1',
    [usernameOrEmail]
  );
  return rows[0] || null;
}

async function findById(id) {
  const { rows } = await pool.query(
    'SELECT * FROM users WHERE id = $1',
    [id]
  );
  return rows[0] || null;
}

async function createUser({ username, email, passwordHash }) {
  const { rows } = await pool.query(
    `INSERT INTO users (username, email, password_hash)
     VALUES ($1, $2, $3)
     RETURNING *`,
    [username, email, passwordHash]
  );

  await pool.query(
    `INSERT INTO user_settings (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO NOTHING`,
    [rows[0].id]
  );

  return rows[0];
}

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

async function createTransaction({ userId, type, cat, title, amount, date }) {
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

async function deleteTransaction(id, userId) {
  const result = await pool.query(
    `DELETE FROM transactions
     WHERE id = $1 AND user_id = $2`,
    [id, userId]
  );
  return result.rowCount > 0;
}

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

async function updateSettings(userId, { openingBalance, budget, notif }) {
  const current = await getSettings(userId);

  const nextOpening = openingBalance !== undefined
    ? Number(openingBalance) : current.openingBalance;
  const nextBudget = budget !== undefined
    ? Number(budget) : current.budget;
  const nextNotif = notif !== undefined
    ? Boolean(notif) : current.notif;

  await pool.query(
    `UPDATE user_settings
     SET opening_balance = $2,
         budget = $3,
         notif = $4,
         updated_at = NOW()
     WHERE user_id = $1`,
    [userId, nextOpening, nextBudget, nextNotif]
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
