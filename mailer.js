// mailer.js
// ส่งอีเมลผ่าน Brevo API (HTTPS) — ใช้บน Render แผนฟรีได้ เพราะไม่ต้องใช้พอร์ต SMTP ที่ถูกบล็อก
// ถ้ายังไม่ได้ตั้งค่า BREVO_API_KEY: ตอน development จะพิมพ์อีเมลออกทาง console แทนการส่งจริง

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';

function isMailConfigured() {
  return Boolean(process.env.BREVO_API_KEY && process.env.MAIL_FROM);
}

async function sendMail({ to, subject, html, text }) {
  if (!isMailConfigured()) {
    console.log('\n===== [อีเมลจำลอง: ยังไม่ได้ตั้งค่า BREVO_API_KEY / MAIL_FROM] =====');
    console.log(`ถึง: ${to}\nหัวข้อ: ${subject}\n\n${text}`);
    console.log('==================================================================\n');
    return;
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

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`ส่งอีเมลไม่สำเร็จ (Brevo ${res.status}): ${detail}`);
  }
}

module.exports = { sendMail, isMailConfigured };
