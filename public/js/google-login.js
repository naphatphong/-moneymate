// google-login.js - ปุ่ม "เข้าสู่ระบบด้วย Google" ใช้ร่วมกันในหน้า login / register
// แสดงปุ่มเฉพาะเมื่อเซิร์ฟเวอร์ตั้งค่า Google ไว้แล้ว และแสดงข้อความเมื่อ Google ส่งกลับมาพร้อม error

(function () {
  const MESSAGES = {
    unavailable: 'ระบบเข้าสู่ระบบด้วย Google ยังไม่พร้อมใช้งาน กรุณาใช้ชื่อผู้ใช้และรหัสผ่าน',
    cancelled: 'ยกเลิกการเข้าสู่ระบบด้วย Google แล้ว',
    expired: 'หมดเวลาเข้าสู่ระบบด้วย Google กรุณากดปุ่มใหม่อีกครั้ง',
    failed: 'เข้าสู่ระบบด้วย Google ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
    unverified: 'อีเมลของบัญชี Google นี้ยังไม่ได้รับการยืนยัน กรุณาใช้บัญชี Google อื่น',
    email_exists: 'อีเมลนี้มีบัญชี MoneyMate อยู่แล้ว กรุณาเข้าสู่ระบบด้วยรหัสผ่านก่อน แล้วกด "เชื่อมต่อ" ที่บัญชี Google ในหน้าโปรไฟล์'
  };

  const code = new URLSearchParams(location.search).get('google');
  const msg = document.getElementById('msg');
  if (code && MESSAGES[code] && msg) {
    msg.textContent = MESSAGES[code];
    msg.className = 'message error';
    history.replaceState(null, '', location.pathname);
  }

  fetch('/api/auth/providers')
    .then((res) => res.json())
    .then((data) => {
      if (data.google) document.getElementById('googleBlock').classList.remove('hidden');
    })
    .catch(() => {});
})();
