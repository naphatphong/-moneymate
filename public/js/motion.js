/* motion.js — แอนิเมชันตอนเลื่อนหน้าที่ใช้ร่วมกันหลายหน้า
   - Motion.reveal(els)       ค่อย ๆ โผล่ขึ้นมาเมื่อเลื่อนมาถึง (เติม class "in" ให้ element ที่มี class "rv")
   - Motion.countOnView(el)   ตัวเลขนับขึ้นเมื่อเลื่อนมาเห็น
   - Motion.scrubWords(el)    ไฮไลต์ทีละคำตามการเลื่อน (ตัดคำไทยด้วย Intl.Segmenter)
   - Motion.parallax(el, k)   เลื่อนช้า/เร็วกว่าหน้าเว็บเล็กน้อย
   - Motion.magnetic(el)      ปุ่มขยับตามเมาส์นิดหน่อย
   - Motion.smoothScroll()    เลื่อนหน้าแบบนุ่ม (Lenis ถ้าโหลดไว้)
   ทุกอย่างปิดเองเมื่อผู้ใช้ตั้งค่า "ลดการเคลื่อนไหว" */
(function () {
  const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const M = { reduced: () => reduceQuery.matches };

  /* ---- scroll subscribers (หนึ่งเฟรมเรียกครั้งเดียว ใช้ได้ทั้งเลื่อนปกติและ Lenis) ---- */
  const subs = [];
  let ticking = false;
  const run = () => { ticking = false; subs.forEach((fn) => fn()); };
  window.addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(run); } }, { passive: true });
  window.addEventListener('resize', () => subs.forEach((fn) => fn()));
  M.onScroll = (fn) => { subs.push(fn); fn(); };

  /* ---- reveal ---- */
  let io = null;
  M.reveal = (targets) => {
    const els = typeof targets === 'string' ? document.querySelectorAll(targets) : targets;
    if (M.reduced() || !('IntersectionObserver' in window)) {
      els.forEach((el) => el.classList.add('rv', 'in'));
      return;
    }
    if (!io) {
      io = new IntersectionObserver((entries) => {
        // element ที่โผล่มาพร้อมกันไล่ดีเลย์จากบนลงล่าง ซ้ายไปขวา
        entries.filter((e) => e.isIntersecting)
          .sort((a, b) => (a.boundingClientRect.top - b.boundingClientRect.top) || (a.boundingClientRect.left - b.boundingClientRect.left))
          .forEach((e, i) => {
            const el = e.target;
            if (!el.dataset.delay) el.style.setProperty('--d', `${Math.min(i, 8) * 0.07}s`);
            el.classList.add('in');
            io.unobserve(el);
          });
      // threshold 0: โผล่ทันทีที่เห็นส่วนใดส่วนหนึ่ง (ถ้าใช้สัดส่วน element ที่สูงกว่าจอจะไม่มีวันถึงเกณฑ์)
      }, { rootMargin: '0px 0px -6% 0px', threshold: 0 });
    }
    els.forEach((el) => {
      if (el.classList.contains('in')) return;
      el.classList.add('rv');
      if (el.dataset.delay) el.style.setProperty('--d', `${el.dataset.delay}s`);
      io.observe(el);
    });
  };

  /* ---- count up ---- */
  M.countUp = (el, to, { from = 0, duration = 1400, format = (v) => Math.round(v).toLocaleString() } = {}) => {
    if (M.reduced()) { el.textContent = format(to); return; }
    const start = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 4);
      el.textContent = format(from + (to - from) * eased);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };
  M.countOnView = (el, opts) => {
    const to = parseFloat(el.dataset.count);
    if (isNaN(to)) return;
    if (M.reduced() || !('IntersectionObserver' in window)) { el.textContent = to.toLocaleString(); return; }
    el.textContent = '0';
    const obs = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) {
        // เลื่อนผ่านไปแล้ว (เช่น รีเฟรชกลางหน้า) — แสดงค่าจริงเลย
        if (e.boundingClientRect.bottom < 0) { obs.disconnect(); el.textContent = to.toLocaleString(); }
        return;
      }
      obs.disconnect();
      M.countUp(el, to, opts);
    }, { threshold: 0.5 });
    obs.observe(el);
  };

  /* ---- scroll-scrubbed word highlight ---- */
  M.scrubWords = (el) => {
    const text = el.textContent.trim().replace(/\s+/g, ' ');
    const parts = window.Intl && Intl.Segmenter
      ? Array.from(new Intl.Segmenter(document.documentElement.lang || 'th', { granularity: 'word' }).segment(text), (s) => s.segment)
      : text.split(/(\s+)/);
    el.textContent = '';
    const words = [];
    parts.forEach((part) => {
      if (/^\s+$/.test(part)) { el.append(part); return; }
      const span = document.createElement('span');
      span.className = 'scrub-word';
      span.textContent = part;
      el.append(span);
      words.push(span);
    });
    if (M.reduced()) { words.forEach((w) => w.classList.add('lit')); return; }
    M.onScroll(() => {
      const r = el.getBoundingClientRect();
      const vh = window.innerHeight;
      // เริ่มสว่างเมื่อย่อหน้าขึ้นมาถึง 85% ของจอ สว่างครบเมื่อท้ายย่อหน้าถึง ~45% ของจอ
      const p = Math.min(1, Math.max(0, (vh * 0.85 - r.top) / (r.height + vh * 0.4)));
      const lit = Math.round(p * words.length);
      words.forEach((w, i) => w.classList.toggle('lit', i < lit));
    });
  };

  /* ---- parallax ---- */
  M.parallax = (el, speed = 0.1) => {
    if (M.reduced()) return;
    M.onScroll(() => {
      const r = el.parentElement.getBoundingClientRect();
      const offset = (r.top + r.height / 2 - window.innerHeight / 2) * -speed;
      el.style.translate = `0 ${offset.toFixed(1)}px`;
    });
  };

  /* ---- magnetic buttons (เฉพาะเมาส์) ---- */
  M.magnetic = (el, strength = 0.22) => {
    if (M.reduced() || !window.matchMedia('(pointer: fine)').matches) return;
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      el.style.translate = `${((e.clientX - r.left - r.width / 2) * strength).toFixed(1)}px ${((e.clientY - r.top - r.height / 2) * strength).toFixed(1)}px`;
    });
    el.addEventListener('pointerleave', () => { el.style.translate = ''; });
  };

  /* ---- smooth scroll (Lenis) ---- */
  M.smoothScroll = () => {
    if (M.reduced() || !window.Lenis) return null;
    const lenis = new window.Lenis({ duration: 1.15, easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)) });
    const raf = (t) => { lenis.raf(t); requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
    document.querySelectorAll('a[href^="#"]').forEach((a) => {
      a.addEventListener('click', (e) => {
        const target = document.querySelector(a.getAttribute('href'));
        if (!target) return;
        e.preventDefault();
        lenis.scrollTo(target, { offset: -90 });
      });
    });
    return lenis;
  };

  window.Motion = M;
})();
