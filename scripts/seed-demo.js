// scripts/seed-demo.js
// สร้างบัญชีตัวอย่างพร้อมข้อมูลการใช้งานย้อนหลัง 1 ปี (นักศึกษาที่ทำงานพิเศษ)
//
// แบบที่ 1 — ผ่านหน้าเว็บ (ง่ายสุด ไม่ต้องใช้รหัสฐานข้อมูล): สมัครและบันทึกผ่าน API ของเว็บ
//   npm run seed:demo -- --url https://<เว็บของคุณ> [--username demo] [--password <รหัสผ่าน>]
//
// แบบที่ 2 — ตรงเข้าฐานข้อมูลใน DATABASE_URL (.env) เร็วกว่า และลบ/สร้างใหม่ได้
//   npm run seed:demo -- --password <รหัสผ่าน>
//   npm run seed:demo -- --username demo --email demo@example.com --password <รหัสผ่าน>
//   npm run seed:demo -- --reset          (ลบบัญชีตัวอย่างเดิมแล้วสร้างใหม่)
//
// ถ้าไม่ใส่ --password จะสุ่มรหัสผ่านให้และแสดงตอนจบ
//
// เพิ่มแผนการเงินตัวอย่างให้บัญชีที่มีอยู่แล้ว (ข้ามรายการที่มีชื่อซ้ำ):
//   npm run seed:demo -- --plan-only --url https://<เว็บของคุณ> --username demo --password <รหัสผ่าน>
//   npm run seed:demo -- --plan-only --username demo       (แบบตรงเข้าฐานข้อมูล ไม่ต้องใช้รหัสผ่าน)
require('dotenv').config();

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
let db = null; // โหลดเฉพาะแบบที่ 2 (แบบผ่านหน้าเว็บไม่ต้องต่อฐานข้อมูล)

// ---------- อ่าน argument ----------
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
};
const USERNAME = opt('username') || 'demo';
const EMAIL = opt('email') || 'demo@example.com';
// รหัสผ่านสุ่ม 10 ตัว ตัดตัวที่สับสนง่าย (0/O, 1/l/I) ออก
const randomPassword = () => {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(10), (b) => chars[b % chars.length]).join('');
};
const PASSWORD = opt('password') || randomPassword();
const RESET = args.includes('--reset');
const PLAN_ONLY = args.includes('--plan-only');
const URL_BASE = (opt('url') || '').replace(/\/+$/, '');

// ---------- สุ่มแบบกำหนด seed (รันกี่ครั้งก็ได้ข้อมูลชุดเดิม) ----------
let seed = 20260921;
const rnd = () => {
  seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const pick = (list) => list[Math.floor(rnd() * list.length)];
const between = (a, b) => Math.round(a + rnd() * (b - a));
const chance = (p) => rnd() < p;

const FOOD = ['ข้าวมันไก่', 'กะเพราหมูสับไข่ดาว', 'ก๋วยเตี๋ยวเรือ', 'ข้าวผัดกุ้ง', 'ส้มตำไก่ย่าง', 'ข้าวขาหมู', 'โจ๊กหมู', 'ราดหน้า', 'ข้าวไข่เจียว', 'สุกี้น้ำ'];
const DRINK = ['ชาไข่มุก', 'กาแฟเย็น', 'ชาเขียวนม', 'น้ำปั่น', 'โกโก้เย็น'];
const TRAVEL_DAILY = ['ค่ารถเมล์', 'ค่าวินมอเตอร์ไซค์', 'ค่ารถไฟฟ้า', 'ค่าสองแถว'];
const TRAVEL_BIG = ['Grab', 'Bolt', 'แท็กซี่'];
const FUN = ['ดูหนัง', 'คาราโอเกะ', 'โบว์ลิ่ง', 'คาเฟ่กับเพื่อน', 'บอร์ดเกมคาเฟ่', 'หมูกระทะกับเพื่อน'];
const SHOP = ['Shopee', 'Lazada', 'เสื้อผ้า', 'ของใช้ส่วนตัว', 'เครื่องเขียน', 'รองเท้า', 'หนังสือเรียน'];
const OTHER = ['ถ่ายเอกสาร', 'ซักรีด', 'ตัดผม', 'ทำบุญ', 'ของขวัญเพื่อน'];
const SALES = ['ขายเสื้อมือสอง', 'ขายชีทสรุป', 'ขายขนมในคณะ', 'รับวาดรูป'];

// เวลาสุ่มในวันนั้น (ช่วงเช้า-ค่ำ)
const at = (day, fromHour, toHour) => {
  const d = new Date(day);
  d.setHours(between(fromHour, toHour), between(0, 59), 0, 0);
  return d;
};

function generate(today) {
  const txs = [];
  const add = (type, cat, title, amount, date) => txs.push({ type, cat, title, amount, date });
  const start = new Date(today);
  start.setFullYear(start.getFullYear() - 1);
  start.setDate(start.getDate() + 1);

  for (let d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
    const day = new Date(d);
    const dom = day.getDate();
    const month = day.getMonth(); // 0 = ม.ค.
    const dow = day.getDay();     // 0 = อาทิตย์
    const weekend = dow === 0 || dow === 6;
    const monthsAgo = (today.getFullYear() - day.getFullYear()) * 12 + today.getMonth() - month;

    // ---- รายรับประจำ ----
    if (dom === 1) add('income', 'allowance', 'ค่าขนมประจำเดือน', monthsAgo <= 5 ? 7500 : 7000, at(day, 8, 10));
    if (dow === 6 && chance(0.85)) add('income', 'parttime', 'สอนพิเศษวันเสาร์', between(6, 9) * 100, at(day, 16, 19));
    if (dom === 15 && (month === 5 || month === 10)) add('income', 'scholarship', 'ทุนเรียนดี (ภาคเรียน)', 10000, at(day, 10, 12));
    if (chance(0.06)) add('income', 'sales', pick(SALES), between(3, 15) * 100, at(day, 12, 21));
    if (month === 0 && dom === 1) add('income', 'ของขวัญ', 'อั่งเปา/ของขวัญปีใหม่', 2000, at(day, 11, 14));
    if (month === 3 && dom === 13) add('income', 'ของขวัญ', 'เงินจากญาติช่วงสงกรานต์', 1500, at(day, 11, 14));

    // ---- รายจ่ายประจำ ----
    if (dom === 3) add('expense', 'ค่าหอ', 'ค่าหอพัก + ค่าน้ำไฟ', between(3400, 3800), at(day, 9, 12));
    if (dom === 5) add('expense', 'other', 'ค่าโทรศัพท์รายเดือน', 299, at(day, 9, 12));
    if (dom === 20 && (month === 5 || month === 10)) add('expense', 'ค่าเทอม', 'ค่าบำรุงการศึกษา', 9000, at(day, 9, 11));

    // ---- เทศกาล ----
    if (month === 3 && dom === 11) add('expense', 'travel', 'ตั๋วรถทัวร์กลับบ้าน (สงกรานต์)', 1200, at(day, 8, 10));
    if (month === 3 && dom === 17) add('expense', 'travel', 'ตั๋วรถทัวร์กลับหอ', 1200, at(day, 14, 18));
    if (month === 10 && dom === 11) add('expense', 'shopping', 'โปร 11.11', between(15, 30) * 100, at(day, 0, 2));
    if (month === 11 && dom === 12) add('expense', 'shopping', 'โปร 12.12', between(10, 25) * 100, at(day, 0, 2));
    if (month === 11 && dom === 31) add('expense', 'entertainment', 'เคานต์ดาวน์กับเพื่อน', 1500, at(day, 19, 22));
    if (month === 7 && dom === 24) add('expense', 'entertainment', 'บัตรคอนเสิร์ต', 2800, at(day, 10, 12));

    // บางวันไม่ได้บันทึก (ลืม/ไม่ได้ใช้จ่าย) — ทำให้ตารางกิจกรรมดูเป็นธรรมชาติ
    if (chance(0.1)) continue;

    // ---- ใช้จ่ายรายวัน ----
    const meals = weekend ? between(1, 3) : between(1, 2);
    for (let m = 0; m < meals; m++) add('expense', 'food', pick(FOOD), between(4, 12) * 5 + (weekend ? 15 : 0), at(day, 7 + m * 5, 9 + m * 5));
    if (chance(0.45)) add('expense', 'food', pick(DRINK), between(5, 9) * 5, at(day, 13, 17));
    if (!weekend && chance(0.7)) add('expense', 'travel', pick(TRAVEL_DAILY), between(3, 10) * 5, at(day, 7, 9));
    if (chance(0.08)) add('expense', 'travel', pick(TRAVEL_BIG), between(8, 25) * 10, at(day, 18, 23));
    if (weekend && chance(0.4)) add('expense', 'entertainment', pick(FUN), between(12, 60) * 10, at(day, 14, 21));
    if (chance(0.09)) add('expense', 'shopping', pick(SHOP), between(15, 150) * 10, at(day, 10, 22));
    if (chance(0.05)) add('expense', 'other', pick(OTHER), between(4, 30) * 10, at(day, 9, 19));
  }
  return txs;
}

// ---------- แผนการเงินตัวอย่าง (รายการประจำ + รายการครั้งเดียวที่กำลังจะมาถึง) ----------
// วันที่ของรายการครั้งเดียว = ครั้งถัดไปของเดือน/วันนั้นนับจากวันนี้
function upcoming(month, day, today = new Date()) {
  let y = today.getFullYear();
  const d = new Date(y, month - 1, day);
  if (d < new Date(today.getFullYear(), today.getMonth(), today.getDate())) y++;
  return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function planItems(today = new Date()) {
  return [
    { type: 'income', name: 'ค่าขนมประจำเดือน', amount: 7500, freq: 'monthly', day: 1, cat: 'allowance' },
    { type: 'income', name: 'สอนพิเศษวันเสาร์', amount: 750, freq: 'weekly', day: 6, cat: 'parttime' },
    { type: 'expense', name: 'ค่าหอพัก + ค่าน้ำไฟ', amount: 3600, freq: 'monthly', day: 3, cat: 'ค่าหอ' },
    { type: 'expense', name: 'ค่าโทรศัพท์รายเดือน', amount: 299, freq: 'monthly', day: 5, cat: 'other' },
    { type: 'expense', name: 'ค่ากินรายวัน', amount: 150, freq: 'daily', cat: 'food' },
    { type: 'expense', name: 'ค่าเดินทางรายวัน', amount: 40, freq: 'daily', cat: 'travel' },
    { type: 'expense', name: 'Spotify', amount: 69, freq: 'monthly', day: 10, cat: 'entertainment' },
    { type: 'income', name: 'ทุนเรียนดี (ภาคเรียน)', amount: 10000, freq: 'once', onDate: upcoming(11, 15, today), cat: 'scholarship' },
    { type: 'expense', name: 'ค่าบำรุงการศึกษา', amount: 9000, freq: 'once', onDate: upcoming(11, 20, today), cat: 'ค่าเทอม' },
    { type: 'expense', name: 'ซื้อโน้ตบุ๊กเครื่องใหม่', amount: 18000, freq: 'once', onDate: upcoming(12, 12, today), cat: 'shopping' },
    { type: 'expense', name: 'ตั๋วรถกลับบ้านช่วงปีใหม่', amount: 1200, freq: 'once', onDate: upcoming(12, 28, today), cat: 'travel' }
  ].map((i) => ({ day: null, onDate: null, ...i }));
}

// ---------- แบบที่ 1: ผ่าน API ของเว็บ ----------
function apiClient() {
  let cookie = '';
  const call = async (method, path, body, attempt = 0) => {
    let res;
    try {
      res = await fetch(URL_BASE + path, {
        method,
        headers: { 'content-type': 'application/json', cookie },
        body: body ? JSON.stringify(body) : undefined
      });
    } catch (err) {
      if (attempt < 4) { await new Promise((r) => setTimeout(r, 3000)); return call(method, path, body, attempt + 1); }
      throw err;
    }
    // เว็บแผนฟรีอาจกำลังตื่น (502/503) — รอแล้วลองใหม่
    if ((res.status === 502 || res.status === 503 || res.status === 429) && attempt < 8) {
      await new Promise((r) => setTimeout(r, 5000));
      return call(method, path, body, attempt + 1);
    }
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${method} ${path} ตอบกลับ ${res.status}: ${data.error || 'ไม่ทราบสาเหตุ'}`);
    return data;
  };
  return call;
}

// เพิ่มแผนตัวอย่าง ข้ามรายการที่มีชื่อนี้อยู่แล้ว — คืนจำนวนที่เพิ่ม
async function addPlan(existingNames, create) {
  const have = new Set(existingNames);
  let added = 0;
  for (const item of planItems()) {
    if (have.has(item.name)) continue;
    await create(item);
    added++;
  }
  return added;
}

async function seedViaApi() {
  const call = apiClient();

  await call('POST', '/api/register', { username: USERNAME, email: EMAIL, password: PASSWORD });
  await call('PUT', '/api/settings', { openingBalance: 12000, budget: 9500 });
  await call('PUT', '/api/survey/dismiss');
  await call('POST', '/api/categories', { type: 'expense', name: 'ค่าหอ' });
  await call('POST', '/api/categories', { type: 'expense', name: 'ค่าเทอม' });
  await call('POST', '/api/categories', { type: 'income', name: 'ของขวัญ' });

  const today = new Date();
  today.setHours(23, 59, 0, 0);
  const txs = generate(today).filter((t) => t.date <= new Date());
  txs.sort((a, b) => a.date - b.date);

  // ส่งพร้อมกันทีละ 6 รายการ
  let done = 0;
  const queue = txs.slice();
  const worker = async () => {
    while (queue.length) {
      const t = queue.shift();
      await call('POST', '/api/transactions', { type: t.type, cat: t.cat, title: t.title, amount: t.amount, date: t.date.toISOString() });
      done++;
      if (done % 100 === 0 || done === txs.length) process.stdout.write(`\r  บันทึกรายการ ${done}/${txs.length}`);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  process.stdout.write('\n');

  for (let i = 0; i <= 12; i++) {
    const m = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const budget = m.getMonth() === 11 ? 12000 : m.getMonth() === 3 ? 11000 : 9500;
    await call('PUT', '/api/budgets', { year: m.getFullYear(), month: m.getMonth() + 1, budget });
  }
  await addPlan([], (item) => call('POST', '/api/plan', item));
  return txs;
}

async function planOnly() {
  let added, total;
  if (URL_BASE) {
    if (!opt('password')) { console.error('แบบผ่านหน้าเว็บต้องใส่ --password ของบัญชีนั้น'); process.exit(1); }
    const call = apiClient();
    await call('POST', '/api/login', { username: USERNAME, password: PASSWORD });
    const { items } = await call('GET', '/api/plan');
    added = await addPlan(items.map((i) => i.name), (item) => call('POST', '/api/plan', item));
    total = items.length + added;
  } else {
    const user = await db.findByLogin(USERNAME);
    if (!user) { console.error(`ไม่พบบัญชี "${USERNAME}"`); process.exit(1); }
    const items = await db.getPlanItems(user.id);
    added = await addPlan(items.map((i) => i.name), (item) => db.createPlanItem(user.id, item));
    total = items.length + added;
  }
  console.log(`เพิ่มแผนการเงินให้ ${USERNAME} แล้ว ${added} รายการ (รวมทั้งหมด ${total} รายการ)`);
}

function printSummary(txs) {
  const income = txs.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expense = txs.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const fmt = (n) => n.toLocaleString('en-US');
  console.log('\nสร้างบัญชีตัวอย่างเรียบร้อย');
  if (URL_BASE) console.log(`  เว็บ      : ${URL_BASE}/login.html`);
  console.log(`  ชื่อผู้ใช้ : ${USERNAME}`);
  console.log(`  อีเมล     : ${EMAIL}`);
  console.log(`  รหัสผ่าน  : ${PASSWORD}${opt('password') ? '' : '   (สุ่มให้ — จดไว้ด้วย)'}`);
  console.log(`  รายการ    : ${fmt(txs.length)} รายการ (${txs[0].date.toLocaleDateString('th-TH')} – ${txs[txs.length - 1].date.toLocaleDateString('th-TH')})`);
  console.log(`  รายรับรวม ฿${fmt(income)} · รายจ่ายรวม ฿${fmt(expense)} · ยอดคงเหลือ ฿${fmt(12000 + income - expense)}`);
}

async function main() {
  if (PLAN_ONLY && URL_BASE) return planOnly();
  if (URL_BASE) {
    if (RESET) {
      console.error('แบบผ่านหน้าเว็บลบบัญชีเดิมไม่ได้ — ใช้ --username ชื่อใหม่ หรือใช้แบบที่ 2 (DATABASE_URL) กับ --reset');
      process.exit(1);
    }
    printSummary(await seedViaApi());
    return;
  }
  db = require('../database');
  if (!process.env.DATABASE_URL) {
    console.error('ไม่พบ DATABASE_URL — ใส่ใน .env ก่อน (ดู .env.example)');
    process.exit(1);
  }
  await db.init();
  if (PLAN_ONLY) return planOnly();

  // ถ้ามีบัญชีนี้อยู่แล้ว: ลบได้เฉพาะเมื่อสั่ง --reset และทั้งชื่อผู้ใช้กับอีเมลตรงกัน (กันลบบัญชีคนอื่น)
  const byName = await db.findByLogin(USERNAME);
  const byEmail = await db.findByEmail(EMAIL);
  if (byName || byEmail) {
    const same = byName && byEmail && byName.id === byEmail.id && byName.username === USERNAME;
    if (!RESET) {
      console.error(`มีบัญชีที่ใช้ชื่อ "${USERNAME}" หรืออีเมล "${EMAIL}" อยู่แล้ว — ถ้าต้องการสร้างใหม่ให้เพิ่ม --reset`);
      process.exit(1);
    }
    if (!same) {
      console.error('ชื่อผู้ใช้และอีเมลไม่ได้เป็นของบัญชีเดียวกัน — ไม่ลบให้ เพื่อกันลบบัญชีของคนอื่น กรุณาใช้ชื่อ/อีเมลอื่น');
      process.exit(1);
    }
    await db.deleteUser(byName.id);
    console.log(`ลบบัญชีตัวอย่างเดิม (${USERNAME}) แล้ว`);
  }

  const user = await db.createUser({ username: USERNAME, email: EMAIL, passwordHash: await bcrypt.hash(PASSWORD, 10) });
  await db.getSettings(user.id); // สร้างแถวค่าตั้งค่าเริ่มต้น
  await db.updateSettings(user.id, { openingBalance: 12000, budget: 9500 });
  await db.dismissSurvey(user.id);
  await db.createCategory(user.id, 'expense', 'ค่าหอ');
  await db.createCategory(user.id, 'expense', 'ค่าเทอม');
  await db.createCategory(user.id, 'income', 'ของขวัญ');

  const today = new Date();
  today.setHours(23, 59, 0, 0);
  const txs = generate(today).filter((t) => t.date <= new Date());
  txs.sort((a, b) => a.date - b.date);
  await db.createTransactionsBulk(user.id, txs);

  // งบประมาณรายเดือน 13 เดือน (ธันวาคมตั้งสูงขึ้นเพราะมีเทศกาล)
  for (let i = 0; i <= 12; i++) {
    const m = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const budget = m.getMonth() === 11 ? 12000 : m.getMonth() === 3 ? 11000 : 9500;
    await db.upsertBudget(user.id, m.getFullYear(), m.getMonth() + 1, budget);
  }
  await addPlan([], (item) => db.createPlanItem(user.id, item));

  printSummary(txs);
}

main()
  .catch((err) => { console.error('สร้างบัญชีตัวอย่างไม่สำเร็จ:', err.message); process.exitCode = 1; })
  .finally(() => db && db.close());
