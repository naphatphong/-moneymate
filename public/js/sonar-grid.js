/* sonar-grid.js — พื้นหลังจุดที่มีคลื่นวงกลมกระจายออก (พอร์ตจากคอมโพเนนต์ React "SonarGrid" มาเป็น JS ธรรมดา)
   วาดบน canvas สีตามธีม (ใช้ค่า color ของ canvas ซึ่ง CSS ตั้งเป็น var(--accent))
   หยุดวาดเมื่อไม่มีคลื่น / แท็บถูกซ่อน / มองไม่เห็น และแสดงเป็นจุดนิ่งเมื่อผู้ใช้ตั้งค่าลดการเคลื่อนไหว

   ใช้งาน: SonarGrid.mount(element, { pingEvery: 2.4, ... }) — element ควรเป็น position:relative/fixed */
(function () {
  const MAX_DPR = 2;
  const TAU = Math.PI * 2;
  const DEFAULTS = {
    spacing: 26,          // ระยะห่างระหว่างจุด (px)
    dotRadius: 1.4,       // รัศมีจุดตอนนิ่ง (px)
    baseOpacity: 0.28,    // ความทึบของจุดตอนนิ่ง (0–1)
    color: null,          // สี CSS ใดก็ได้ ถ้าไม่ใส่ใช้ var(--accent)
    pingEvery: 2.4,       // วินาทีระหว่างคลื่นอัตโนมัติ (0 = ปิด)
    speed: 260,           // ความเร็วคลื่น (px/วินาที)
    ringWidth: 90,        // ความหนาของหน้าคลื่น (px)
    amplitude: 2.2,       // จุดขยายเท่าไหร่ตอนคลื่นผ่าน
    interactive: true,    // คลิก/แตะแล้วมีคลื่น
    pointerTarget: null,  // ฟังการคลิกจาก element ไหน (ค่าเริ่มต้นคือ host)
    maxRings: 6,
    seedPing: true,       // เริ่มมาก็มีคลื่นอยู่หนึ่งวง
    pingArea: [0.15, 0.2, 0.85, 0.8] // พื้นที่ที่คลื่นอัตโนมัติเกิด [x0, y0, x1, y1] เป็นสัดส่วน
  };

  function mount(host, options) {
    const o = Object.assign({}, DEFAULTS, options);
    const canvas = document.createElement('canvas');
    canvas.className = 'sonar-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    if (o.color) canvas.style.color = o.color;
    host.prepend(canvas);
    const ctx = canvas.getContext('2d');
    if (!ctx) return { destroy() { canvas.remove(); } };

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let rings = [];
    let width = 0, height = 0, raf = 0, timer = 0;
    let visible = true, seeded = false, fill = '';
    let nextPing = performance.now() + o.pingEvery * 1000;

    const readColor = () => { fill = getComputedStyle(canvas).color; };

    const addRing = (x, y, born) => {
      readColor();
      rings.push({ x, y, born });
      while (rings.length > o.maxRings) rings.shift();
    };

    const draw = (now) => {
      const lifetime = (Math.hypot(width, height) + o.ringWidth) / o.speed; // วินาทีจนคลื่นออกนอกจอ
      rings = rings.filter((r) => (now - r.born) / 1000 < lifetime);
      const live = rings.map((r) => {
        const age = (now - r.born) / 1000;
        const radius = age * o.speed;
        return { x: r.x, y: r.y, radius, reach: radius + o.ringWidth, fade: 1 - age / lifetime };
      });

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = fill;
      const cols = Math.ceil(width / o.spacing) + 1;
      const rows = Math.ceil(height / o.spacing) + 1;
      const offsetX = (width - (cols - 1) * o.spacing) / 2;
      const offsetY = (height - (rows - 1) * o.spacing) / 2;

      // รอบแรก: จุดที่นิ่งทั้งหมดวาดใน path เดียว
      const hot = [];
      ctx.globalAlpha = o.baseOpacity;
      ctx.beginPath();
      for (let i = 0; i < cols; i++) {
        const cx = offsetX + i * o.spacing;
        for (let j = 0; j < rows; j++) {
          const cy = offsetY + j * o.spacing;
          let energy = 0;
          for (const r of live) {
            if (Math.abs(cx - r.x) > r.reach || Math.abs(cy - r.y) > r.reach) continue;
            const dist = Math.abs(Math.hypot(cx - r.x, cy - r.y) - r.radius);
            if (dist >= o.ringWidth) continue;
            const t = 1 - dist / o.ringWidth;
            const k = t * t * (3 - 2 * t) * r.fade; // smoothstep ค่อย ๆ จางตามอายุคลื่น
            if (k > energy) energy = k;
          }
          if (energy < 0.01) {
            ctx.moveTo(cx + o.dotRadius, cy);
            ctx.arc(cx, cy, o.dotRadius, 0, TAU);
          } else {
            hot.push(cx, cy, energy);
          }
        }
      }
      ctx.fill();

      // รอบสอง: เฉพาะจุดบนหน้าคลื่น ปรับความทึบและขนาดทีละจุด
      for (let k = 0; k < hot.length; k += 3) {
        const energy = hot[k + 2];
        ctx.globalAlpha = o.baseOpacity + (1 - o.baseOpacity) * energy;
        ctx.beginPath();
        ctx.arc(hot[k], hot[k + 1], o.dotRadius * (1 + o.amplitude * energy), 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    const resize = () => {
      const rect = host.getBoundingClientRect();
      width = Math.max(1, Math.round(rect.width));
      height = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!seeded) {
        seeded = true;
        const [x0, y0, x1, y1] = o.pingArea;
        if (o.seedPing && !reduceMotion.matches) {
          addRing(width * (x0 + (x1 - x0) * 0.68), height * (y0 + (y1 - y0) * 0.34), performance.now() - 500);
        }
      }
      draw(performance.now());
    };

    const scheduleIdle = (delay) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => tick(performance.now()), Math.max(16, delay));
    };

    const tick = (now) => {
      raf = 0;
      if (!visible || document.hidden) return;
      if (reduceMotion.matches) {
        rings = [];
        draw(now);
        return;
      }
      if (o.pingEvery > 0 && now >= nextPing) {
        const [x0, y0, x1, y1] = o.pingArea;
        addRing(width * (x0 + Math.random() * (x1 - x0)), height * (y0 + Math.random() * (y1 - y0)), now);
        nextPing = now + o.pingEvery * 1000;
      }
      draw(now);
      if (rings.length > 0) raf = requestAnimationFrame(tick);
      else if (o.pingEvery > 0) scheduleIdle(nextPing - now);
    };

    const wake = () => {
      if (!raf) {
        window.clearTimeout(timer);
        raf = requestAnimationFrame(tick);
      }
    };

    const onDown = (e) => {
      if (!o.interactive || reduceMotion.matches) return;
      const rect = host.getBoundingClientRect();
      addRing(e.clientX - rect.left, e.clientY - rect.top, performance.now());
      wake();
    };
    const onVisibility = () => { if (!document.hidden) wake(); };
    // ธีมเปลี่ยน (theme.js ตั้งค่า style/data-mode บน <html>) -> อ่านสีใหม่แล้ววาดใหม่
    const onTheme = () => { readColor(); if (!raf) draw(performance.now()); };

    const ro = new ResizeObserver(resize);
    const io = new IntersectionObserver(([entry]) => {
      visible = entry ? entry.isIntersecting : true;
      if (visible) wake();
    }, { threshold: 0 });
    const mo = new MutationObserver(onTheme);
    const pointerTarget = o.pointerTarget || host;

    readColor();
    resize();
    ro.observe(host);
    io.observe(host);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style', 'data-mode'] });
    pointerTarget.addEventListener('pointerdown', onDown);
    document.addEventListener('visibilitychange', onVisibility);
    reduceMotion.addEventListener('change', wake);
    wake();

    return {
      ping(x, y) { addRing(x, y, performance.now()); wake(); },
      destroy() {
        ro.disconnect(); io.disconnect(); mo.disconnect();
        pointerTarget.removeEventListener('pointerdown', onDown);
        document.removeEventListener('visibilitychange', onVisibility);
        reduceMotion.removeEventListener('change', wake);
        cancelAnimationFrame(raf);
        window.clearTimeout(timer);
        canvas.remove();
      }
    };
  }

  window.SonarGrid = { mount };
})();
