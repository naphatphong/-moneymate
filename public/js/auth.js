// auth.js - ฟังก์ชันช่วยเรียก API และแสดงข้อความ ใช้ร่วมกันทั้งหน้า login/register

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  let data = {};
  try {
    data = await res.json();
  } catch (e) {
    // ไม่มี body หรือไม่ใช่ JSON
  }

  if (!res.ok) {
    throw new Error(data.error || 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
  }

  return data;
}

function showMessage(el, text, type) {
  el.textContent = text;
  el.className = 'message ' + type;
}
