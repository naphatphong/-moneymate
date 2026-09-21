// mailer.js
// ส่งอีเมลผ่าน Brevo API (HTTPS) — ใช้บน Render แผนฟรีได้ เพราะไม่ต้องใช้พอร์ต SMTP ที่ถูกบล็อก
// ถ้ายังไม่ได้ตั้งค่า BREVO_API_KEY / MAIL_FROM จะพิมพ์อีเมลออกทาง console แทนการส่งจริง
// (server.js อนุญาตให้เป็นแบบนี้เฉพาะตอนทดสอบบน localhost)

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';
const REQUIRED_MAIL_ENV = ['BREVO_API_KEY', 'MAIL_FROM'];

// อ่านค่าจาก environment โดยตัดช่องว่างและเครื่องหมายคำพูดที่เผลอติดมาตอนคัดลอกวาง
function env(name) {
  return (process.env[name] || '').trim().replace(/^(["'])(.*)\1$/, '$2').trim();
}

function missingMailConfig() {
  return REQUIRED_MAIL_ENV.filter((name) => !env(name));
}

// Brevo มีคีย์ 2 แบบ: API key (xkeysib-...) ใช้กับโค้ดนี้ ส่วน SMTP key (xsmtpsib-...) ใช้ไม่ได้
function apiKeyProblem() {
  const key = env('BREVO_API_KEY');
  if (!key) return null;
  if (key.startsWith('xsmtpsib-')) {
    return 'BREVO_API_KEY ที่ใส่ไว้เป็น SMTP key (ขึ้นต้นด้วย xsmtpsib-) ต้องใช้ API key (ขึ้นต้นด้วย xkeysib-) — ใน Brevo ไปที่ SMTP & API > แท็บ API Keys แล้วกด Generate a new API key';
  }
  if (!key.startsWith('xkeysib-')) {
    return 'BREVO_API_KEY ไม่ได้ขึ้นต้นด้วย xkeysib- อาจคัดลอกมาไม่ครบหรือผิดตัว — สร้าง API key ใหม่ใน Brevo (SMTP & API > API Keys) แล้วคัดลอกทั้งหมดตอนที่ Brevo แสดงครั้งแรก';
  }
  return null;
}

function isMailConfigured() {
  return missingMailConfig().length === 0;
}

async function sendMail({ to, subject, html, text }) {
  if (!isMailConfigured()) {
    console.log('\n===== [อีเมลจำลอง: ยังไม่ได้ตั้งค่า BREVO_API_KEY / MAIL_FROM] =====');
    console.log(`ถึง: ${to}\nหัวข้อ: ${subject}\n\n${text}`);
    console.log('==================================================================\n');
    return { messageId: null, simulated: true };
  }

  const res = await fetch(BREVO_ENDPOINT, {
    method: 'POST',
    headers: {
      'api-key': env('BREVO_API_KEY'),
      'content-type': 'application/json',
      accept: 'application/json'
    },
    body: JSON.stringify({
      sender: { email: env('MAIL_FROM'), name: env('MAIL_FROM_NAME') || 'MoneyMate' },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      textContent: text
    })
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Brevo ตอบกลับ ${res.status}: ${body.message || body.code || 'ไม่ทราบสาเหตุ'}`);
    err.status = res.status;
    err.brevoMessage = String(body.message || body.code || '');
    throw err;
  }
  return { messageId: body.messageId || null, simulated: false };
}

// แปล error ที่เจอบ่อยจาก Brevo เป็นวิธีแก้
function explainMailError(err) {
  const msg = (err.brevoMessage || err.message || '').toLowerCase();
  if (/\bip\b/.test(msg)) {
    return 'Brevo บล็อก IP ของเซิร์ฟเวอร์ (Render เปลี่ยน IP ได้ตลอด) — เข้า Brevo ไปที่เมนู Security > Authorised IPs แล้วปิดการบล็อก IP ที่ไม่รู้จัก';
  }
  if (err.status === 401 || msg.includes('key')) {
    return apiKeyProblem() ||
      'Brevo ไม่รู้จัก API key นี้ (อาจถูกลบไปแล้วหรือคัดลอกมาไม่ครบ) — สร้าง API key ใหม่ใน Brevo (SMTP & API > API Keys) แล้วแทนค่า BREVO_API_KEY ใน Render จากนั้นรอ deploy ใหม่';
  }
  if (msg.includes('sender')) {
    return 'อีเมลผู้ส่ง (MAIL_FROM) ยังไม่ได้ยืนยันใน Brevo — ไปที่ Senders, Domains & Dedicated IPs > Senders แล้วกดยืนยันจากอีเมลที่ Brevo ส่งมา';
  }
  if (msg.includes('not yet activated') || msg.includes('activat') || msg.includes('suspend')) {
    return 'บัญชี Brevo ยังไม่เปิดให้ส่งอีเมล transactional — เช็คอีเมลจาก Brevo หรือกรอกข้อมูลบัญชีให้ครบ แล้วรอ Brevo อนุมัติ';
  }
  if (err.status === undefined) {
    return 'เชื่อมต่อ Brevo ไม่ได้ (ปัญหาเครือข่ายของเซิร์ฟเวอร์) — ลองใหม่อีกครั้ง';
  }
  return 'ดูรายละเอียด error ด้านบน และเช็คหน้า Transactional > Logs ใน Brevo';
}

module.exports = { sendMail, isMailConfigured, missingMailConfig, apiKeyProblem, explainMailError };
