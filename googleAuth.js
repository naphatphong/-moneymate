// googleAuth.js
// ล็อกอินด้วย Google แบบ OAuth 2.0 authorization code + PKCE (ไม่ต้องลงไลบรารีเพิ่ม)
// 1) buildAuthUrl: พาผู้ใช้ไปหน้าเลือกบัญชีของ Google
// 2) fetchGoogleProfile: Google ส่ง code กลับมา -> แลกเป็น access token -> ดึงข้อมูลบัญชี (sub, email)
//    ทั้งหมดคุยกับ Google โดยตรงจากฝั่งเซิร์ฟเวอร์ผ่าน HTTPS จึงเชื่อข้อมูลที่ได้กลับมาได้

const crypto = require('crypto');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

// อ่านค่าจาก environment โดยตัดช่องว่างและเครื่องหมายคำพูดที่เผลอติดมาตอนคัดลอกวาง
function env(name) {
  return (process.env[name] || '').trim().replace(/^(["'])(.*)\1$/, '$2').trim();
}

function missingGoogleConfig() {
  return ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'].filter((name) => !env(name));
}

function randomToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function buildAuthUrl({ redirectUri, state, codeVerifier }) {
  const params = new URLSearchParams({
    client_id: env('GOOGLE_CLIENT_ID'),
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: crypto.createHash('sha256').update(codeVerifier).digest('base64url'),
    code_challenge_method: 'S256',
    prompt: 'select_account'
  });
  return `${AUTH_URL}?${params}`;
}

async function fetchGoogleProfile({ code, redirectUri, codeVerifier }) {
  const tokenRes = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env('GOOGLE_CLIENT_ID'),
      client_secret: env('GOOGLE_CLIENT_SECRET'),
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier
    })
  });
  const token = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !token.access_token) {
    throw new Error(`แลก code กับ Google ไม่สำเร็จ (${tokenRes.status}): ${token.error || ''} ${token.error_description || ''}`.trim());
  }

  const profileRes = await fetch(USERINFO_URL, { headers: { authorization: `Bearer ${token.access_token}` } });
  const profile = await profileRes.json().catch(() => ({}));
  if (!profileRes.ok || !profile.sub) {
    throw new Error(`ดึงข้อมูลบัญชี Google ไม่สำเร็จ (${profileRes.status})`);
  }
  return {
    sub: String(profile.sub),
    email: profile.email ? String(profile.email) : '',
    emailVerified: profile.email_verified === true || profile.email_verified === 'true',
    name: profile.name ? String(profile.name) : ''
  };
}

module.exports = { missingGoogleConfig, randomToken, buildAuthUrl, fetchGoogleProfile };
