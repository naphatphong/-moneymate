/* ai-core.js — "แกน AI" ทำจากอนุภาค (canvas 2D) ใช้ในหน้าแรก
   const core = AICore.mount(canvas, { shapes: ['sphere', 'bars'], count: 1000 });
   core.set(p)  — p = 0 คือรูปแรก, 1 คือรูปที่สอง ... (ทศนิยมได้ ใช้เปลี่ยนรูปตามการเลื่อน)
   - ลูกบอลหมุนเอง / รูปแบน (กราฟ เกจ แชท) หันหน้าเข้าจอเสมอ
   - ลากเพื่อหมุนได้ทั้งเมาส์และนิ้ว (ปล่อยแล้วหมุนต่อด้วยแรงเฉื่อย รูปแบนค่อย ๆ หันกลับมาตรง)
   - เอียงตามเมาส์เล็กน้อย อนุภาคหลบเคอร์เซอร์
   - หยุดวาดเมื่อไม่อยู่บนจอ / แท็บถูกซ่อน และวาดภาพนิ่งเมื่อผู้ใช้ตั้งค่า "ลดการเคลื่อนไหว"
   รูปทรงที่มี: sphere, cloud, bars, calendar, gauge, bubble */
(function () {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  /* ---------- รูปทรง: จุด [x, y, z, tone] (y ชี้ลง ขนาดราว -1..1; tone 1 = สีหลัก, 0 = ปกติ, -1 = จาง) ---------- */
  function gridIn(x0, y0, x1, y1, step, tone) {
    const out = [];
    const ox = ((x1 - x0) % step) / 2, oy = ((y1 - y0) % step) / 2;
    for (let x = x0 + ox; x <= x1 + 1e-9; x += step) {
      for (let y = y1 - oy; y >= y0 - 1e-9; y -= step) out.push([x, y, (rnd() - 0.5) * 0.05, tone]);
    }
    return out;
  }
  // ให้ได้ n จุดพอดี: เกินก็เลือกกระจายเท่า ๆ กัน ขาดก็เติมด้วย extra()
  function fit(pts, n, extra) {
    if (pts.length > n) {
      const out = [];
      for (let i = 0; i < n; i++) out.push(pts[Math.floor((i * pts.length) / n)]);
      return out;
    }
    while (pts.length < n) pts.push(extra());
    return pts;
  }
  const along = (poly, t) => { // จุดบนเส้นหักตามสัดส่วน t
    const segs = poly.length - 1, f = t * segs, i = Math.min(segs - 1, Math.floor(f)), u = f - i;
    return [poly[i][0] + (poly[i + 1][0] - poly[i][0]) * u, poly[i][1] + (poly[i + 1][1] - poly[i][1]) * u];
  };

  const SHAPES = {
    sphere(n) {
      const out = [], g = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < n; i++) {
        const y = 1 - (i / (n - 1)) * 2, r = Math.sqrt(1 - y * y), t = g * i;
        out.push([Math.cos(t) * r, y, Math.sin(t) * r, Math.abs(y) < 0.045 || rnd() < 0.05 ? 1 : 0]);
      }
      return out;
    },
    cloud(n) {
      const out = [];
      for (let i = 0; i < n; i++) {
        const u = rnd() * 2 - 1, th = rnd() * Math.PI * 2, r = 1.3 + rnd() * 1.7, s = Math.sqrt(1 - u * u);
        out.push([Math.cos(th) * s * r * 1.35, u * r * 0.75, Math.sin(th) * s * r, rnd() < 0.07 ? 1 : -1]);
      }
      return out;
    },
    // กราฟแท่งรายจ่าย 7 เดือน + เส้นแนวโน้ม (เดือนล่าสุดเป็นสีหลัก)
    bars(n) {
      const H = [0.5, 0.78, 0.6, 0.95, 0.68, 0.84, 1.24], w = 0.17, gap = 0.3, base = 0.7;
      const area = H.reduce((s, h) => s + h * w, 0), step = Math.sqrt(area / (n * 0.8));
      let pts = [];
      H.forEach((h, i) => { const cx = (i - 3) * gap; pts = pts.concat(gridIn(cx - w / 2, base - h, cx + w / 2, base, step, i === 6 ? 1 : 0)); });
      const trend = H.map((h, i) => [(i - 3) * gap, base - h - 0.16]);
      const floor = [[-1.05, base + 0.09], [1.05, base + 0.09]];
      return fit(pts, n, () => (rnd() < 0.72 ? [...along(trend, rnd()), 0, 1] : [...along(floor, rnd()), 0, -1]));
    },
    // ปฏิทินรายจ่ายประจำ (7x5) วันที่มีรายการเป็นสีหลัก
    calendar(n) {
      const cell = 0.24, gap = 0.065, x0 = -(7 * cell + 6 * gap) / 2, y0 = -0.55;
      const hot = new Set([0, 2, 4, 11, 19]); // วันที่ 1 (รายรับ) 3 (ค่าหอ) 5 (ค่าเน็ต) 12, 20
      const step = Math.sqrt((35 * cell * cell) / (n * 0.84));
      let pts = [];
      for (let r = 0; r < 5; r++) for (let c = 0; c < 7; c++) {
        const d = r * 7 + c, x = x0 + c * (cell + gap), y = y0 + r * (cell + gap);
        pts = pts.concat(gridIn(x + 0.02, y + 0.02, x + cell - 0.02, y + cell - 0.02, step, hot.has(d) ? 1 : c >= 5 ? -1 : 0));
      }
      const title = [[x0, y0 - 0.26], [x0 + 0.9, y0 - 0.26]], nav = [[-x0 - 0.3, y0 - 0.26], [-x0, y0 - 0.26]];
      return fit(pts, n, () => (rnd() < 0.7 ? [...along(title, rnd()), 0, 0] : [...along(nav, rnd()), 0, -1]));
    },
    // หน้าปัดงบประมาณ ใช้ไป 86%
    gauge(n) {
      const cx = 0, cy = 0.42, R = 1.02, th = 0.2, fill = 0.86, out = [];
      const band = Math.floor(n * 0.74), needle = Math.floor(n * 0.14);
      const rings = 5, per = Math.floor(band / rings);
      for (let k = 0; k < rings; k++) {
        const r = R - th / 2 + (k / (rings - 1)) * th;
        for (let i = 0; i < per; i++) {
          const f = i / (per - 1), a = Math.PI + f * Math.PI;
          out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, (rnd() - 0.5) * 0.05, f <= fill ? 1 : -1]);
        }
      }
      const na = Math.PI + fill * Math.PI;
      for (let i = 0; i < needle; i++) {
        const t = i / needle, r = t * R * 0.78;
        out.push([cx + Math.cos(na) * r + (rnd() - 0.5) * 0.02, cy + Math.sin(na) * r + (rnd() - 0.5) * 0.02, 0, 0]);
      }
      while (out.length < n) {
        const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.1;
        out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0, 0]);
      }
      return out.slice(0, n);
    },
    // กล่องแชท + จุดกำลังพิมพ์
    bubble(n) {
      const w = 2.0, h = 1.2, r = 0.32, cx = 0, cy = -0.1, x0 = cx - w / 2, y0 = cy - h / 2, x1 = cx + w / 2, y1 = cy + h / 2;
      const outline = [];
      const arc = (ax, ay, a0, a1, m) => { for (let i = 0; i <= m; i++) { const a = a0 + (a1 - a0) * (i / m); outline.push([ax + Math.cos(a) * r, ay + Math.sin(a) * r]); } };
      outline.push([x0 + r, y0], [x1 - r, y0]); arc(x1 - r, y0 + r, -Math.PI / 2, 0, 8);
      outline.push([x1, y1 - r]); arc(x1 - r, y1 - r, 0, Math.PI / 2, 8);
      outline.push([x0 + 0.72, y1], [x0 + 0.42, y1 + 0.34], [x0 + 0.46, y1]);
      outline.push([x0 + r, y1]); arc(x0 + r, y1 - r, Math.PI / 2, Math.PI, 8);
      outline.push([x0, y0 + r]); arc(x0 + r, y0 + r, Math.PI, Math.PI * 1.5, 8);
      // จุดบนเส้นขอบแบบระยะเท่ากัน
      const lens = [0];
      for (let i = 1; i < outline.length; i++) lens.push(lens[i - 1] + Math.hypot(outline[i][0] - outline[i - 1][0], outline[i][1] - outline[i - 1][1]));
      const total = lens[lens.length - 1], edgeN = Math.floor(n * 0.5), out = [];
      for (let k = 0; k < edgeN; k++) {
        const L = (k / edgeN) * total;
        let i = 1; while (i < lens.length - 1 && lens[i] < L) i++;
        const u = (L - lens[i - 1]) / (lens[i] - lens[i - 1] || 1);
        out.push([outline[i - 1][0] + (outline[i][0] - outline[i - 1][0]) * u, outline[i - 1][1] + (outline[i][1] - outline[i - 1][1]) * u, (rnd() - 0.5) * 0.05, 0]);
      }
      const dotsN = Math.floor(n * 0.22);
      for (let k = 0; k < dotsN; k++) {
        const c = k % 3, a = rnd() * Math.PI * 2, rr = Math.sqrt(rnd()) * 0.11;
        out.push([cx + (c - 1) * 0.36 + Math.cos(a) * rr, cy + Math.sin(a) * rr, 0, 1]);
      }
      const inner = gridIn(x0 + 0.12, y0 + 0.12, x1 - 0.12, y1 - 0.12, 0.085, -1).filter((p) => Math.abs(p[1] - cy) > 0.18);
      return fit(out.concat(fit(inner, n - out.length, () => [x0 + rnd() * w, y0 + rnd() * h, 0, -1])), n, () => [0, 0, 0, -1]);
    }
  };

  function rgb(str) {
    str = String(str || '').trim();
    if (str[0] === '#') {
      let h = str.slice(1);
      if (h.length === 3) h = h.split('').map((c) => c + c).join('');
      const v = parseInt(h.slice(0, 6), 16);
      return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    }
    const m = str.match(/[\d.]+/g);
    return m ? m.slice(0, 3).map(Number) : [255, 255, 255];
  }

  function mount(canvas, opts = {}) {
    const N = opts.count || 900;
    const names = opts.shapes || ['sphere'];
    const shapes = names.map((nm) => SHAPES[nm](N));
    const spins = names.map((nm) => (nm === 'sphere' || nm === 'cloud' ? 1 : 0));
    const scaleK = opts.scale || 0.36;
    const P = Array.from({ length: N }, () => ({ d: rnd(), sx: rnd() * 2 - 1, sy: rnd() * 2 - 1, sz: rnd() * 2 - 1, tw: rnd() * 6.28, ox: 0, oy: 0 }));
    const X = new Float32Array(N), Y = new Float32Array(N), A = new Float32Array(N), S = new Float32Array(N), T = new Int8Array(N);
    const ctx = canvas.getContext('2d');
    let W = 0, H = 0, dpr = 1, prog = 0, target = 0, running = false, visible = false, raf = 0, frameN = 0, spin = 0, last = 0;
    const mouse = { x: -1e5, y: -1e5, nx: 0, ny: 0, tx: 0, ty: 0 };
    // การลากหมุน: yaw/pitch ที่ผู้ใช้หมุนเอง + ความเร็วสำหรับแรงเฉื่อย
    const drag = { on: false, id: null, x: 0, y: 0, t: 0, yaw: 0, pitch: 0, vy: 0, vp: 0 };
    const TAU = Math.PI * 2;
    let base = [255, 255, 255], hi = [47, 191, 143], light = false;

    function readColors() {
      const cs = getComputedStyle(document.documentElement);
      hi = rgb(cs.getPropertyValue('--accent'));
      base = rgb(cs.getPropertyValue('--text'));
      light = document.documentElement.dataset.mode === 'light';
    }
    function resize() {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(1, Math.round(r.width * dpr)); H = Math.max(1, Math.round(r.height * dpr));
      canvas.width = W; canvas.height = H;
      if (!running) draw(performance.now());
    }

    function draw(now) {
      const time = now / 1000;
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
      last = now;
      if (frameN++ % 40 === 0) readColors();
      const still = reduce.matches;
      prog = still ? target : prog + (target - prog) * Math.min(1, dt * 7);
      mouse.nx += (mouse.tx - mouse.nx) * Math.min(1, dt * 3);
      mouse.ny += (mouse.ty - mouse.ny) * Math.min(1, dt * 3);
      const i0 = Math.min(shapes.length - 1, Math.floor(prog)), i1 = Math.min(shapes.length - 1, i0 + 1), t = shapes.length > 1 ? prog - i0 : 0;
      const spinW = spins[i0] * (1 - t) + spins[i1] * t;
      if (!still) {
        // ลูกบอลหมุนเอง; พอเปลี่ยนเป็นรูปแบน มุมหมุนค่อย ๆ คืนสู่ด้านหน้า (รอบที่ใกล้สุด) ไม่ค้างเอียงข้าง
        if (!drag.on) spin += dt * 0.32 * spinW;
        const flat = 1 - spinW;
        spin += (Math.round(spin / TAU) * TAU - spin) * Math.min(1, dt * 4 * flat);
        if (!drag.on) {
          // แรงเฉื่อยหลังปล่อย แล้วรูปแบนสปริงกลับมาตรง (ลูกบอลค้างมุมที่หมุนไว้)
          drag.yaw += drag.vy * dt; drag.pitch += drag.vp * dt;
          const fr = Math.exp(-dt * 2.6); drag.vy *= fr; drag.vp *= fr;
          if (flat > 0.001) drag.yaw += (Math.round(drag.yaw / TAU) * TAU - drag.yaw) * Math.min(1, dt * 3.2 * flat);
          drag.pitch += (0 - drag.pitch) * Math.min(1, dt * 2.4);
        }
      }
      const ry = spin + drag.yaw + mouse.nx * 0.3, rx = -mouse.ny * 0.22 + 0.22 * spinW + drag.pitch;
      const cr = Math.cos(ry), sr = Math.sin(ry), cx_ = Math.cos(rx), sx_ = Math.sin(rx);
      const breathe = still ? 1 : 1 + Math.sin(time * 1.1) * 0.012;
      const Sc = Math.min(W, H) * scaleK * breathe, D = 3.4, cx = W / 2, cy = H / 2;
      const R = 80 * dpr, R2 = R * R, push = 30 * dpr;
      const A0 = shapes[i0], B0 = shapes[i1];
      for (let k = 0; k < N; k++) {
        const a = A0[k], b = B0[k], p = P[k];
        const tk = clamp01((t - p.d * 0.35) / 0.65), e = ease(tk), sw = Math.sin(Math.PI * tk) * 0.38;
        const x = a[0] + (b[0] - a[0]) * e + p.sx * sw, y = a[1] + (b[1] - a[1]) * e + p.sy * sw, z = a[2] + (b[2] - a[2]) * e + p.sz * sw;
        T[k] = e < 0.5 ? a[3] : b[3];
        const x1 = x * cr - z * sr, z1 = x * sr + z * cr;
        const y2 = y * cx_ - z1 * sx_, z2 = y * sx_ + z1 * cx_;
        const ps = D / (D + z2);
        let px = cx + x1 * Sc * ps, py = cy + y2 * Sc * ps;
        // หลบเคอร์เซอร์
        const dx = px - mouse.x, dy = py - mouse.y, d2 = dx * dx + dy * dy;
        let tx = 0, ty = 0;
        if (d2 < R2 && !still && !drag.on) { const d = Math.sqrt(d2) || 1, f = 1 - d / R; tx = (dx / d) * f * f * push; ty = (dy / d) * f * f * push; }
        p.ox += (tx - p.ox) * 0.16; p.oy += (ty - p.oy) * 0.16;
        X[k] = px + p.ox; Y[k] = py + p.oy;
        const depth = clamp01((1 - z2) / 2);
        A[k] = (0.22 + 0.78 * depth) * (T[k] < 0 ? 0.38 : 1);
        S[k] = (0.9 + 1.2 * depth) * dpr * (T[k] > 0 ? 1.3 : 1);
      }
      ctx.clearRect(0, 0, W, H);
      // แสงเรือง ๆ ตรงกลางตอนเป็นลูกบอล
      if (spinW > 0.02) {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, Sc * 1.25);
        g.addColorStop(0, `rgba(${hi[0]},${hi[1]},${hi[2]},${(light ? 0.1 : 0.16) * spinW})`);
        g.addColorStop(1, `rgba(${hi[0]},${hi[1]},${hi[2]},0)`);
        ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
      for (let k = 0; k < N; k++) {
        if (T[k] > 0) continue;
        ctx.globalAlpha = A[k] * (light ? 0.8 : 0.72);
        const s = S[k]; ctx.fillRect(X[k] - s / 2, Y[k] - s / 2, s, s);
      }
      ctx.fillStyle = `rgb(${hi[0]},${hi[1]},${hi[2]})`;
      if (!light) ctx.globalCompositeOperation = 'lighter';
      for (let k = 0; k < N; k++) {
        if (T[k] <= 0) continue;
        const tw = still ? 1 : 0.72 + 0.28 * Math.sin(time * 2.6 + P[k].tw);
        const s = S[k];
        ctx.globalAlpha = A[k] * 0.16 * tw; ctx.fillRect(X[k] - s * 1.6, Y[k] - s * 1.6, s * 3.2, s * 3.2);
        ctx.globalAlpha = A[k] * tw; ctx.fillRect(X[k] - s / 2, Y[k] - s / 2, s, s);
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    }

    function loop(now) {
      if (!running) return;
      draw(now);
      raf = requestAnimationFrame(loop);
    }
    function update() {
      const should = visible && !document.hidden && !reduce.matches;
      if (!should) { drag.on = false; drag.vy = drag.vp = 0; }
      if (should && !running) { running = true; last = 0; raf = requestAnimationFrame(loop); }
      else if (!should && running) { running = false; cancelAnimationFrame(raf); }
    }

    new ResizeObserver(resize).observe(canvas);
    new IntersectionObserver(([en]) => { visible = en.isIntersecting; update(); }, { rootMargin: '120px' }).observe(canvas);
    document.addEventListener('visibilitychange', update);
    reduce.addEventListener && reduce.addEventListener('change', () => { update(); draw(performance.now()); });

    // เมาส์: เอียงตามตำแหน่ง (เทียบกับกลาง canvas) + ตำแหน่งจริงสำหรับหลบเคอร์เซอร์
    const target_ = opts.pointerTarget || canvas;
    target_.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return;
      const r = canvas.getBoundingClientRect();
      mouse.x = (e.clientX - r.left) * dpr; mouse.y = (e.clientY - r.top) * dpr;
      mouse.tx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width / 2)));
      mouse.ty = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / (r.height / 2)));
    });
    target_.addEventListener('pointerleave', () => { mouse.x = mouse.y = -1e5; mouse.tx = mouse.ty = 0; });

    // ลากเพื่อหมุน — นิ้วลากแนวนอนหมุน ลากแนวตั้งยังเลื่อนหน้าได้ปกติ (touch-action: pan-y)
    canvas.style.touchAction = 'pan-y';
    canvas.style.cursor = 'grab';
    canvas.addEventListener('pointerdown', (e) => {
      if (reduce.matches || (e.pointerType === 'mouse' && e.button !== 0)) return;
      Object.assign(drag, { on: true, id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), vy: 0, vp: 0 });
      canvas.setPointerCapture(e.pointerId);
      canvas.style.cursor = 'grabbing';
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!drag.on || e.pointerId !== drag.id) return;
      const now = performance.now(), dt = Math.max(1, now - drag.t) / 1000;
      const k = 5.2 / Math.max(260, canvas.clientWidth); // ลากเต็มความกว้าง ≈ หมุนเกือบรอบ
      const dy = (e.clientX - drag.x) * k, dp = (e.clientY - drag.y) * k * 0.6;
      drag.yaw += dy;
      drag.pitch = Math.max(-0.7, Math.min(0.7, drag.pitch + dp));
      // ความเร็วเฉลี่ยนุ่ม ๆ ใช้ตอนปล่อย
      drag.vy = drag.vy * 0.6 + (dy / dt) * 0.4;
      drag.vp = drag.vp * 0.6 + (dp / dt) * 0.4;
      drag.x = e.clientX; drag.y = e.clientY; drag.t = now;
      if (!running) draw(now);
    });
    const release = (e) => {
      if (!drag.on || e.pointerId !== drag.id) return;
      drag.on = false;
      // ค้างนิ่งก่อนปล่อย = ไม่ต้องหมุนต่อ
      if (performance.now() - drag.t > 90) drag.vy = drag.vp = 0;
      drag.vy = Math.max(-9, Math.min(9, drag.vy));
      drag.vp = Math.max(-4, Math.min(4, drag.vp));
      canvas.style.cursor = 'grab';
    };
    canvas.addEventListener('pointerup', release);
    canvas.addEventListener('pointercancel', release);

    readColors();
    resize();
    return {
      set(p) {
        target = Math.max(0, Math.min(shapes.length - 1, p));
        if (!running) draw(performance.now());
      }
    };
  }

  window.AICore = { mount };
})();
