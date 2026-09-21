// mailer.js
// ส่งอีเมลผ่าน Brevo API (HTTPS) — ใช้บน Render แผนฟรีได้ เพราะไม่ต้องใช้พอร์ต SMTP ที่ถูกบล็อก
// ถ้ายังไม่ได้ตั้งค่า BREVO_API_KEY / MAIL_FROM จะพิมพ์อีเมลออกทาง console แทนการส่งจริง
// (server.js อนุญาตให้เป็นแบบนี้เฉพาะตอนทดสอบบน localhost)

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';
const REQUIRED_MAIL_ENV = ['BREVO_API_KEY', 'MAIL_FROM'];

function missingMailConfig() {
  return REQUIRED_MAIL_ENV.filter((name) => !process.env[name]);
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
      'api-key': process.env.BREVO_API_KEY,
      'content-type': 'application/json',
      accept: 'application/json'
    },
    body: JSON.stringify({
      sender: { email: process.env.MAIL_FROM, name: process.env.MAIL_FROM_NAME || 'MoneyMate' },
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
    return 'API key ไม่ถูกต้อง — สร้าง key ใหม่ใน Brevo (SMTP & API > API Keys) แล้วใส่ BREVO_API_KEY ใน Render ใหม่ ระวังช่องว่างหัว/ท้าย';
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

module.exports = { sendMail, isMailConfigured, missingMailConfig, explainMailError };
