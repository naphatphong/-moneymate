/* motion.js — แอนิเมชันตอนเลื่อนหน้าที่ใช้ร่วมกันหลายหน้า
   - Motion.reveal(els)       เลื่อนเข้ามาเมื่อเห็นบนจอ และเลื่อนออกเมื่อพ้นจอ ทั้งขาลงและขาขึ้น (class "rv" + "in"/"above")
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

  /* ---- reveal: เลื่อนเข้า–เลื่อนออกได้ทั้งสองทิศ ----
     เห็นบนจอ → "in" | พ้นขอบบน → "above" (ลอยขึ้นแล้วจางหาย) | พ้นขอบล่าง → กลับไปรอด้านล่าง
     ขอบบนของพื้นที่ตรวจหดเข้ามา 12% เพื่อให้เห็นจังหวะเลื่อนออก ไม่ใช่หายไปตอนพ้นจอแล้ว
     element ที่มี class "lines" ใช้แอนิเมชันหัวข้อทีละบรรทัดแทน "rv"
     ส่ง { once: true } ถ้าอยากให้โผล่ครั้งเดียวแล้วค้างไว้ */
  const SHIFT = 36; // ระยะเลื่อนหลบ ต้องตรงกับ .rv / .rv.above ใน ui.css
  const observers = {};
  const seen = new WeakSet();
  const observer = (once) => {
    const key = once ? 'once' : 'both';
    if (observers[key]) return observers[key];
    const io = new IntersectionObserver((entries) => {
      // element ที่โผล่มาพร้อมกันไล่ดีเลย์จากบนลงล่าง ซ้ายไปขวา
      entries.filter((e) => e.isIntersecting)
        .sort((a, b) => (a.boundingClientRect.top - b.boundingClientRect.top) || (a.boundingClientRect.left - b.boundingClientRect.left))
        .forEach((e, i) => {
          const el = e.target;
          // data-delay ใช้แค่รอบแรก (จังหวะเปิดหน้า) รอบต่อ ๆ ไปไล่ดีเลย์สั้น ๆ ตามลำดับ
          const d = el.dataset.delay && !seen.has(el) ? +el.dataset.delay : Math.min(i, 8) * 0.07;
          el.style.setProperty('--d', `${d}s`);
          seen.add(el);
          el.classList.remove('above');
          el.classList.add('in');
          if (once) io.unobserve(el);
        });
      if (once) return;
      entries.filter((e) => !e.isIntersecting).forEach((e) => {
        const el = e.target, r = e.boundingClientRect;
        // ถูกซ่อนด้วย display:none → กลับไปรอด้านล่าง
        if (!r.height) { el.classList.remove('in', 'above', 'still'); return; }
        const rb = e.rootBounds || { top: 0, bottom: window.innerHeight };
        const up = r.top < rb.top; // ออกทางขอบบน
        // ตำแหน่งจริงบนหน้า (ไม่นับระยะที่เลื่อนหลบอยู่) ใช้ดูว่าเลื่อนกลับมาถึงได้ไหม
        const ty = parseFloat((getComputedStyle(el).translate || '').split(' ')[1]) || 0;
        const top = r.top + window.scrollY - ty, bottom = r.bottom + window.scrollY - ty;
        const end = document.documentElement.scrollHeight - window.innerHeight + rb.bottom;
        const shift = SHIFT + (el.classList.contains('card') ? r.height * 0.02 : 0);
        // อยู่ท้ายหน้าจนไม่มีวันเลื่อนถึงพื้นที่ตรวจ → โชว์ไว้เลย
        if (!up && top >= end) { el.classList.add('in'); return; }
        el.classList.remove('in');
        el.classList.toggle('above', up);
        // ชิดหัวหรือท้ายหน้า ถ้าเลื่อนหลบแล้วจะกลับเข้าพื้นที่ตรวจไม่ได้ → จางหายอยู่กับที่แทน
        el.classList.toggle('still', up ? bottom - shift <= rb.top : top + shift >= end);
      });
    // threshold 0: โผล่ทันทีที่เห็นส่วนใดส่วนหนึ่ง (ถ้าใช้สัดส่วน element ที่สูงกว่าจอจะไม่มีวันถึงเกณฑ์)
    }, { rootMargin: once ? '0px 0px -6% 0px' : '-12% 0px -6% 0px', threshold: 0 });
    return (observers[key] = io);
  };
  M.reveal = (targets, { once = false } = {}) => {
    const els = typeof targets === 'string' ? document.querySelectorAll(targets) : targets;
    const mark = (el) => { if (!el.classList.contains('lines')) el.classList.add('rv'); };
    if (M.reduced() || !('IntersectionObserver' in window)) {
      els.forEach((el) => { mark(el); el.classList.add('in'); });
      return;
    }
    const io = observer(once);
    els.forEach((el) => {
      if (once && el.classList.contains('in')) return;
      mark(el);
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
