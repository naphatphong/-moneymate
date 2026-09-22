/* robot.js — หุ่นยนต์ผู้ช่วย 3 มิติในส่วนหัวของหน้าแรก (Three.js ผ่าน import map ใน index.html)
   - หันหัวและกลอกตาตามเมาส์/นิ้ว ถ้าว่างจะมองไปรอบ ๆ เอง
   - กะพริบตา ลอยขึ้นลง โบกมือทักทายตอนเปิดหน้าและเป็นระยะ
   - แตะ/คลิก: กระโดดหมุนตัวดีใจ
   - เลื่อนลง: เอนตัวไปด้านหลังและเล็กลง
   - หยุดวาดเมื่อพ้นจอหรือแท็บถูกซ่อน, ผู้ใช้ตั้งค่า "ลดการเคลื่อนไหว" = ภาพนิ่ง
   สีตา/ไฟ/แสงขอบใช้สีหลักของธีม (--accent) */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const canvas = document.getElementById('botCanvas');
const btn = document.getElementById('botBtn');
const hero = document.getElementById('hero');
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, k) => a + (b - a) * k;
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function init() {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch (err) {
    btn.closest('.stage3d').classList.add('no-bot'); // ไม่มี WebGL: เหลือแค่วงแสงกับการ์ดข้อมูล
    return;
  }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  camera.position.set(0, 0.2, 8.6);
  camera.lookAt(0, -0.1, 0);

  // ---- สี / วัสดุ ----
  const accent = new THREE.Color('#2FBF8F');
  let accentStr = '';
  const readAccent = () => {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2FBF8F';
    if (v === accentStr) return false;
    accentStr = v;
    accent.setStyle(v);
    return true;
  };
  readAccent();
  const shell = new THREE.MeshPhysicalMaterial({ color: 0xeef1f5, roughness: 0.3, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.14, envMapIntensity: 0.85 });
  const visorMat = new THREE.MeshPhysicalMaterial({ color: 0x05070a, roughness: 0.1, metalness: 0.5, clearcoat: 1, clearcoatRoughness: 0.04 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1a1e24, roughness: 0.45, metalness: 0.7 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0xc9d0d8, roughness: 0.28, metalness: 0.85 });
  const glowMat = new THREE.MeshBasicMaterial({ color: accent });
  const mouthMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.75 });
  const tex = glowTexture();
  const spriteMats = [];
  const glowSprite = (size, opacity) => {
    const m = new THREE.SpriteMaterial({ map: tex, color: accent, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity });
    spriteMats.push(m);
    const s = new THREE.Sprite(m);
    s.scale.setScalar(size);
    return s;
  };

  // ---- ไฟ ----
  scene.add(new THREE.HemisphereLight(0xffffff, 0x1a2230, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(3, 4, 5);
  scene.add(key);
  const rimL = new THREE.DirectionalLight(accent, 2.6);
  rimL.position.set(-4, 2.5, -3);
  scene.add(rimL);
  const rimR = new THREE.DirectionalLight(accent, 1.4);
  rimR.position.set(4, 1, -3);
  scene.add(rimR);

  // ---- ตัวหุ่น ----
  const sphere = new THREE.SphereGeometry(1, 64, 48);
  const robot = new THREE.Group();
  scene.add(robot);
  const spinner = new THREE.Group(); // หมุนตัวตอนดีใจ แยกจากการหันตามเมาส์
  robot.add(spinner);

  const body = new THREE.Mesh(sphere, shell);
  body.scale.set(0.78, 0.96, 0.74);
  body.position.y = -0.62;
  spinner.add(body);
  // ไฟวงแหวนที่หน้าอก
  const chest = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.024, 16, 64), glowMat);
  chest.position.set(0, -0.42, 0.73);
  chest.rotation.x = -0.16;
  spinner.add(chest);
  const chestGlow = glowSprite(0.7, 0.5);
  chestGlow.position.set(0, -0.42, 0.78);
  spinner.add(chestGlow);

  // หัว: ลอยแยกจากตัว (ไม่มีคอ)
  const HS = new THREE.Vector3(0.95, 0.74, 0.86);
  const headPivot = new THREE.Group();
  headPivot.position.y = 0.58;
  spinner.add(headPivot);
  const skull = new THREE.Mesh(sphere, shell);
  skull.scale.copy(HS);
  headPivot.add(skull);
  // หน้ากากดำมันวาว (แผ่นโค้งแนบหน้าหัว)
  const visor = new THREE.Mesh(new THREE.SphereGeometry(1.012, 64, 32, Math.PI / 2 - 0.98, 1.96, 0.98, 1.2), visorMat);
  visor.scale.copy(HS);
  headPivot.add(visor);
  const onHead = (phi, theta, r) => new THREE.Vector3(
    -Math.cos(phi) * Math.sin(theta) * HS.x * r, Math.cos(theta) * HS.y * r, Math.sin(phi) * Math.sin(theta) * HS.z * r);

  // ตา: วงรีเรืองแสง + แสงฟุ้ง (อยู่ในกลุ่มเดียวเพื่อเลื่อนไปมองตามเมาส์)
  const eyeRig = new THREE.Group();
  headPivot.add(eyeRig);
  const eyeGeo = new THREE.SphereGeometry(1, 32, 16);
  const eyes = [-1, 1].map((sd) => {
    const g = new THREE.Group();
    g.position.copy(onHead(Math.PI / 2 + sd * 0.3, 1.47, 1.02));
    g.rotation.y = sd * 0.33;
    const eye = new THREE.Mesh(eyeGeo, glowMat);
    eye.scale.set(0.085, 0.13, 0.03);
    g.add(eye);
    const halo = glowSprite(0.55, 0.85);
    halo.position.z = 0.02;
    g.add(halo);
    eyeRig.add(g);
    return { g, eye, halo, baseY: g.position.y };
  });
  // ปากยิ้ม
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.013, 12, 32, Math.PI), mouthMat);
  mouth.position.copy(onHead(Math.PI / 2, 1.83, 1.018));
  mouth.rotation.set(-0.3, 0, Math.PI);
  eyeRig.add(mouth);

  // หู
  [-1, 1].forEach((sd) => {
    const ear = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.1, 40), shell);
    ear.rotation.z = Math.PI / 2;
    ear.position.set(sd * 0.93, 0.02, 0);
    headPivot.add(ear);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.03, 40), darkMat);
    cap.rotation.z = Math.PI / 2;
    cap.position.set(sd * 0.99, 0.02, 0);
    headPivot.add(cap);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.105, 0.012, 12, 48), glowMat);
    ring.rotation.y = Math.PI / 2;
    ring.position.set(sd * 1.006, 0.02, 0);
    headPivot.add(ring);
  });

  // เสาอากาศ
  const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.028, 0.34, 16), metalMat);
  stalk.position.y = 0.86;
  headPivot.add(stalk);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.065, 24, 16), glowMat);
  tip.position.y = 1.05;
  headPivot.add(tip);
  const tipGlow = glowSprite(0.5, 0.8);
  tipGlow.position.y = 1.05;
  headPivot.add(tipGlow);

  // แขน (หมุนจากหัวไหล่)
  const arms = [-1, 1].map((sd) => {
    const pivot = new THREE.Group();
    pivot.position.set(sd * 0.74, -0.28, 0);
    spinner.add(pivot);
    const arm = new THREE.Mesh(sphere, shell);
    arm.scale.set(0.17, 0.46, 0.2);
    arm.position.set(sd * 0.2, -0.4, 0);
    pivot.add(arm);
    return { pivot, sd };
  });

  // แสงบนพื้น + เงา (อยู่กับที่ ตัวหุ่นลอยอยู่เหนือ)
  const floorGlowMat = new THREE.MeshBasicMaterial({ map: tex, color: accent, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.32 });
  const floorGlow = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 2.8), floorGlowMat);
  floorGlow.rotation.x = -Math.PI / 2;
  floorGlow.position.y = -1.9;
  scene.add(floorGlow);
  const shadowMat = new THREE.MeshBasicMaterial({ map: tex, color: 0x000000, transparent: true, depthWrite: false, opacity: 0.4 });
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.9), shadowMat);
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -1.89;
  scene.add(shadow);

  // ---- ขนาด ----
  function resize() {
    const r = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  resize();
  new ResizeObserver(() => { resize(); if (!running) frame(performance.now()); }).observe(canvas);

  // ---- สถานะการเคลื่อนไหว ----
  const st = { yaw: -0.25, pitch: 0.05, bodyYaw: -0.1, eyeX: 0, eyeY: 0, lean: 0, sc: 1 };
  const tg = { yaw: -0.25, pitch: 0.05, eyeX: 0, eyeY: 0, lean: 0, sc: 1 };
  let pointerAt = -1e9, pX = 0, pY = 0;
  let nextLook = 0, nextBlink = 1.2, blinkAt = -1, waveAt = 0.9, nextWave = 11, happyAt = -1;

  const aim = (clientX, clientY) => {
    const r = canvas.getBoundingClientRect();
    pX = clamp((clientX - (r.left + r.width / 2)) / (window.innerWidth * 0.45), -1, 1);
    pY = clamp((clientY - (r.top + r.height * 0.32)) / (window.innerHeight * 0.45), -1, 1);
    pointerAt = performance.now();
  };
  hero.addEventListener('pointermove', (e) => aim(e.clientX, e.clientY));
  hero.addEventListener('pointerleave', () => { pointerAt = -1e9; });
  btn.addEventListener('click', () => {
    const t = performance.now() / 1000;
    if (happyAt < 0 || t - happyAt > 1.4) happyAt = t;
    if (!running) frame(performance.now());
  });
  const onScroll = () => {
    const r = hero.getBoundingClientRect();
    const p = clamp(-r.top / (r.height * 0.8), 0, 1);
    tg.lean = p * 0.55;
    tg.sc = 1 - p * 0.2;
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // ---- วาด ----
  let running = false, raf = 0, visible = true, frameN = 0, last = 0;
  function frame(now) {
    const t = now / 1000, dt = Math.min(0.05, last ? t - last : 0.016);
    last = t;
    const still = reduce.matches;
    if (frameN++ % 60 === 0 && readAccent()) {
      rimL.color.copy(accent); rimR.color.copy(accent);
    }

    // ทิศที่มอง: ตามเมาส์ หรือมองไปรอบ ๆ เอง
    const following = now - pointerAt < 2500;
    if (still) {
      tg.yaw = -0.25; tg.pitch = 0.05; tg.eyeX = 0; tg.eyeY = 0;
    } else if (following) {
      tg.yaw = pX * 0.75; tg.pitch = pY * 0.42;
      tg.eyeX = pX * 0.05; tg.eyeY = -pY * 0.035;
    } else if (t > nextLook) {
      tg.yaw = (Math.random() * 2 - 1) * 0.6; tg.pitch = -0.12 + Math.random() * 0.34;
      tg.eyeX = tg.yaw * 0.06; tg.eyeY = -tg.pitch * 0.06;
      nextLook = t + 1.6 + Math.random() * 1.8;
    }
    const k = still ? 1 : Math.min(1, dt * (following ? 7 : 3.2));
    st.yaw = lerp(st.yaw, tg.yaw, k);
    st.pitch = lerp(st.pitch, tg.pitch, k);
    st.bodyYaw = lerp(st.bodyYaw, tg.yaw * 0.4, still ? 1 : Math.min(1, dt * 2));
    st.eyeX = lerp(st.eyeX, tg.eyeX, still ? 1 : Math.min(1, dt * 12));
    st.eyeY = lerp(st.eyeY, tg.eyeY, still ? 1 : Math.min(1, dt * 12));
    st.lean = lerp(st.lean, tg.lean, still ? 1 : Math.min(1, dt * 6));
    st.sc = lerp(st.sc, tg.sc, still ? 1 : Math.min(1, dt * 6));

    // ดีใจ: กระโดด + หมุนตัว + ตายิ้ม
    const h = happyAt >= 0 ? t - happyAt : 99;
    const jump = h < 0.7 ? Math.sin(Math.PI * (h / 0.7)) * 0.38 : 0;
    const spin = h < 0.95 ? easeInOut(h / 0.95) * Math.PI * 2 : 0;
    const happy = h < 1.5;

    const float = still ? 0 : Math.sin(t * 1.3) * 0.07;
    robot.position.y = float + jump;
    robot.rotation.set(-st.lean, st.bodyYaw, 0);
    robot.scale.setScalar(st.sc);
    spinner.rotation.y = spin;
    headPivot.position.y = 0.58 + (still ? 0 : Math.sin(t * 1.3 - 0.7) * 0.02);
    headPivot.rotation.set(st.pitch, st.yaw - st.bodyYaw, -(st.yaw - st.bodyYaw) * 0.12);
    eyeRig.position.set(st.eyeX, st.eyeY, 0);

    // กะพริบตา
    if (!still && t > nextBlink) { blinkAt = t; nextBlink = t + 2.6 + Math.random() * 2.6; }
    const b = blinkAt >= 0 && t - blinkAt < 0.16 ? 1 - Math.sin(Math.PI * ((t - blinkAt) / 0.16)) : 1;
    eyes.forEach((e) => {
      e.eye.scale.y = 0.13 * Math.max(0.08, b) * (happy ? 0.45 : 1);
      e.g.position.y = e.baseY + (happy ? 0.025 : 0);
      e.halo.material.opacity = 0.85 * Math.max(0.2, b);
    });
    mouth.scale.setScalar(happy ? 1.35 : 1);

    // แขน: แกว่งเบา ๆ / โบกมือ / ชูสองแขนตอนดีใจ
    if (!still && t > nextWave && now - pointerAt > 2500) { waveAt = t; nextWave = t + 10 + Math.random() * 6; }
    const w = waveAt >= 0 ? t - waveAt : 99;
    const waveEnv = w < 2 ? Math.min(1, w / 0.3) * Math.min(1, (2 - w) / 0.35) : 0;
    arms.forEach(({ pivot, sd }) => {
      let z = sd * (0.14 + (still ? 0 : Math.sin(t * 1.3 + sd) * 0.05));
      if (sd > 0 && waveEnv > 0) z = lerp(z, 2.5 + Math.sin(w * 11) * 0.35, easeInOut(waveEnv));
      if (happy) z = lerp(z, sd * 2.2, Math.min(1, h / 0.25) * Math.min(1, (1.5 - h) / 0.3));
      pivot.rotation.z = z;
      pivot.rotation.x = still ? 0 : Math.sin(t * 1.1 + sd) * 0.08;
    });

    // ไฟกระพริบเบา ๆ
    const pulse = still ? 0.7 : 0.55 + 0.35 * Math.sin(t * 3);
    tipGlow.material.opacity = happy ? 1 : pulse;
    tip.scale.setScalar(happy ? 1.4 : 1);
    chestGlow.material.opacity = 0.3 + 0.25 * (still ? 0.5 : 0.5 + 0.5 * Math.sin(t * 1.6));

    // เงาหดเมื่อลอยสูง
    const lift = robot.position.y + 0.07;
    shadow.scale.setScalar(clamp(1 - lift * 0.9, 0.55, 1.1));
    shadowMat.opacity = document.documentElement.dataset.mode === 'light' ? 0.28 * shadow.scale.x : 0.45 * shadow.scale.x;
    floorGlowMat.opacity = 0.32 * shadow.scale.x;

    renderer.render(scene, camera);
    if (!canvas.classList.contains('ready')) canvas.classList.add('ready');
  }

  function loop(now) {
    if (!running) return;
    frame(now);
    raf = requestAnimationFrame(loop);
  }
  function update() {
    const should = visible && !document.hidden && !reduce.matches;
    if (should && !running) { running = true; last = 0; raf = requestAnimationFrame(loop); }
    else if (!should && running) { running = false; cancelAnimationFrame(raf); }
    if (!should) frame(performance.now());
  }
  new IntersectionObserver(([e]) => { visible = e.isIntersecting; update(); }, { rootMargin: '80px' }).observe(canvas);
  document.addEventListener('visibilitychange', update);
  if (reduce.addEventListener) reduce.addEventListener('change', update);
  update();
}

init();
