/* theme.js — โหมดมืด/สว่าง + สีหลักที่ผู้ใช้เลือก ใช้ร่วมกันทุกหน้า
   โหลดแบบปกติ (ไม่ใช่ defer) ใน <head> เพื่อใช้ธีมที่จำไว้ได้ทันที หน้าจอจะไม่กะพริบเป็นสีเริ่มต้นก่อน */
const THEME_DEFAULT = { mode:'dark', accent:'#2FBF8F' };
const THEME_ACCENTS = [
  { hex:'#2FBF8F', th:'มรกต', en:'Emerald' },
  { hex:'#3B9EE8', th:'มหาสมุทร', en:'Ocean' },
  { hex:'#9B7BF0', th:'ม่วงลาเวนเดอร์', en:'Lavender' },
  { hex:'#EC6A9C', th:'กุหลาบ', en:'Rose' },
  { hex:'#F08A4B', th:'พระอาทิตย์ตก', en:'Sunset' },
  { hex:'#E3B23C', th:'ทอง', en:'Gold' },
  { hex:'#A3AEB5', th:'กราไฟต์', en:'Graphite' }
];
const THEME_STORAGE_KEY = 'moneymate-theme';
let themePref = { ...THEME_DEFAULT };

function hexToRgb(hex){ const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function rgbToHex(c){ return '#' + c.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('').toUpperCase(); }
function mixRgb(a, b, amount){ return a.map((v, i) => v + (b[i] - v) * amount); }
function rgba(c, alpha){ return `rgba(${c.map(Math.round).join(',')},${alpha})`; }
function luminance(c){
  const l = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
}
function contrastRatio(a, b){
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function resolveThemeMode(mode){
  if(mode === 'system') return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  return mode === 'light' ? 'light' : 'dark';
}

// ตั้งค่าสีทั้งหน้า: พื้นหลังเกือบดำ/ขาว ย้อมด้วยสีหลักนิดเดียว และปรับสีหลักให้ตัดกับพื้นหลังพอจะอ่านออก
function applyTheme(pref){
  themePref = {
    mode: ['dark', 'light', 'system'].includes(pref && pref.mode) ? pref.mode : THEME_DEFAULT.mode,
    accent: /^#[0-9a-f]{6}$/i.test(pref && pref.accent) ? pref.accent.toUpperCase() : THEME_DEFAULT.accent
  };
  const mode = resolveThemeMode(themePref.mode);
  const light = mode === 'light';
  const base = hexToRgb(themePref.accent);
  const tone = (neutral, amount) => mixRgb(neutral, base, amount);

  const bg = light ? tone([243,244,246], 0.03) : tone([6,7,9], 0.035);
  let accent = base;
  const towards = light ? [0,0,0] : [255,255,255];
  for(let i = 0; i < 16 && contrastRatio(accent, bg) < 3; i++) accent = mixRgb(accent, towards, 0.08);
  const onAccent = luminance(accent) > 0.18 ? rgbToHex(mixRgb(accent, [0,0,0], 0.86)) : '#FFFFFF';

  const vars = light ? {
    '--bg': rgbToHex(bg),
    '--panel': rgba(tone([255,255,255], 0.02), 0.82),
    '--panel-solid': rgbToHex(tone([255,255,255], 0.012)),
    '--pill': rgbToHex(tone([255,255,255], 0.012)),
    '--sidebar-bg': rgba(tone([255,255,255], 0.02), 0.62),
    '--text-soft': rgbToHex(tone([92,99,108], 0.1))
  } : {
    '--bg': rgbToHex(bg),
    '--panel': rgba(tone([22,24,27], 0.05), 0.6),
    '--panel-solid': rgbToHex(tone([15,17,19], 0.04)),
    '--pill': rgbToHex(tone([18,20,23], 0.04)),
    '--sidebar-bg': rgba(tone([10,11,13], 0.03), 0.6),
    '--text-soft': rgbToHex(tone([140,146,155], 0.08))
  };
  vars['--accent'] = rgbToHex(accent);
  vars['--on-accent'] = onAccent;

  const root = document.documentElement;
  Object.keys(vars).forEach(k => root.style.setProperty(k, vars[k]));
  root.dataset.mode = mode;
  const meta = document.querySelector('meta[name="theme-color"]');
  if(meta) meta.content = vars['--bg'];
  try{ localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(themePref)); }catch(err){}
}

try{ applyTheme(JSON.parse(localStorage.getItem(THEME_STORAGE_KEY)) || THEME_DEFAULT); }catch(err){ applyTheme(THEME_DEFAULT); }
window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
  if(themePref.mode === 'system') applyTheme(themePref);
});
