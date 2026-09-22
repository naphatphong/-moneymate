/* showcase.js — ส่วนนำเสนอในหน้าแรกที่เล่นเป็นแอนิเมชัน
   1) โมเดลจำลองการวางแผน (#planSim): ใส่รายการ → ไล่คำนวณทีละวัน → AI ปรับแผน วนซ้ำ ซิงก์กับขั้นตอนด้านซ้าย
   2) การ์ดฟีเจอร์ (.tile): แต่ละใบเล่นตัวอย่างการใช้งานของตัวเอง และเอียงตามเมาส์
   ทุกฉากเดินเฉพาะตอนอยู่บนจอ, ผู้ใช้ตั้งค่า "ลดการเคลื่อนไหว" = แสดงภาพสุดท้ายนิ่ง ๆ */
(function () {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = window.matchMedia('(pointer: fine)').matches;
  const $ = (id) => document.getElementById(id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const clamp01 = (v) => Math.max(0, Math.min(1, v));
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const baht = (v) => (v < 0 ? '−' : '') + '฿' + Math.round(Math.abs(v)).toLocaleString('en-US');
  const seg = window.Intl && Intl.Segmenter ? new Intl.Segmenter('th', { granularity: 'grapheme' }) : null;
  const chars = (s) => (seg ? [...seg.segment(s)].map((x) => x.segment) : [...s]);

  // เล่นฉากวนไปเรื่อย ๆ เฉพาะตอนมองเห็น (เวลาของฉากหยุดเดินเมื่อพ้นจอ)
  function scene(el, loop, final) {
    if (!el) return;
    if (reduced) { final(); return; }
    let vis = false;
    new IntersectionObserver(([e]) => { vis = e.isIntersecting; }, { threshold: 0.3 }).observe(el);
    const wait = async (ms) => {
      let left = ms;
      while (left > 0) { const s = Math.min(40, left); await sleep(s); if (vis && !document.hidden) left -= s; }
    };
    (async () => { for (;;) { while (!vis || document.hidden) await sleep(200); await loop(wait); } })();
  }
  async function count(el, from, to, ms, fmt, wait) {
    const n = Math.max(1, Math.round(ms / 30));
    for (let i = 1; i <= n; i++) { el.textContent = fmt(from + (to - from) * ease(i / n)); await wait(30); }
  }
  async function type(el, text, wait, speed = 26) {
    const cs = chars(text);
    for (let i = 1; i <= cs.length; i++) { el.textContent = cs.slice(0, i).join(''); await wait(speed); }
  }
  // เอียงตามเมาส์ + สปอตไลต์
  function tilt(el, deg) {
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${e.clientX - r.left}px`);
      el.style.setProperty('--my', `${e.clientY - r.top}px`);
      if (!fine || reduced) return;
      const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      el.style.setProperty('--ry', `${(x * deg).toFixed(2)}deg`);
      el.style.setProperty('--rx', `${(-y * deg).toFixed(2)}deg`);
    });
    el.addEventListener('pointerleave', () => { el.style.removeProperty('--rx'); el.style.removeProperty('--ry'); });
  }
  document.querySelectorAll('.tile').forEach((t) => tilt(t, 7));

  /* =====================================================================
     1) โมเดลจำลองการวางแผน — วาดจากเวลา t แบบ pure จึงกระโดดไปฉากไหนก็ได้
  ===================================================================== */
  (function () {
    const sim = $('planSim');
    if (!sim) return;
    tilt(sim, 4);
    const steps = [...document.querySelectorAll('#planSteps li')];
    const chips = [...sim.querySelectorAll('.sim-it')];
    const laptopChip = $('simLaptop');
    const big = $('simBig'), lab = $('simLabel'), chip = $('simChip'), call = $('simCall');
    const aiBox = $('simAi'), apply = $('simApply');

    // ข้อมูลตัวอย่าง: พ.ย. 2569 (1 พ.ย. เป็นวันอาทิตย์)
    const START = 17169, DAYS = 30, SAT = [7, 14, 21, 28];
    const EV = [
      { d: 1, v: 7500, name: 'เงินจากบ้าน' },
      { d: 3, v: -3500, name: 'ค่าหอ' },
      { d: 12, v: -12000, name: 'โน้ตบุ๊ก', laptop: true },
      { d: 20, v: -9000, name: 'ค่าเทอม' }
    ];
    const series = (withLaptop) => {
      const out = [START];
      let x = START;
      for (let d = 1; d <= DAYS; d++) {
        x -= 150;
        if (SAT.includes(d)) x += 450;
        EV.forEach((e) => { if (e.d === d && (withLaptop || !e.laptop)) x += e.v; });
        out.push(x);
      }
      return out;
    };
    const A = series(true), B = series(false);
    const firstNeg = A.findIndex((v) => v < 0);
    const minA = Math.min(...A);
    let safe = Infinity;
    B.forEach((v, i) => { if (i) safe = Math.min(safe, v / i); });
    $('simAiText').textContent = `ถ้าเลื่อนซื้อโน้ตบุ๊ก ฿12,000 ไปเดือน ม.ค. เดือนนี้จะเหลือ ${baht(B[DAYS])} และไม่ติดลบเลย`;

    // กราฟ
    const W = 460, H = 150, PX = 8, PY = 14;
    const lo = Math.min(0, ...A, ...B), hi = Math.max(...A, ...B);
    const X = (d) => PX + (d / DAYS) * (W - PX * 2);
    const Y = (v) => PY + ((hi - v) / (hi - lo)) * (H - PY * 2);
    const y0 = Y(0);
    const chart = $('simChart');
    chart.innerHTML = `<svg viewBox="0 0 ${W} ${H}" aria-hidden="true"><defs>
        <linearGradient id="simGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--accent);stop-opacity:0.3"/><stop offset="1" style="stop-color:var(--accent);stop-opacity:0"/></linearGradient>
        <clipPath id="simPosC"><rect x="-10" y="-40" width="${W + 20}" height="${(y0 + 40).toFixed(1)}"/></clipPath>
        <clipPath id="simNegC"><rect x="-10" y="${y0.toFixed(1)}" width="${W + 20}" height="${(H - y0 + 40).toFixed(1)}"/></clipPath></defs>
      ${[0.25, 0.5, 0.75].map((f) => `<line class="sim-grid" x1="0" x2="${W}" y1="${(H * f).toFixed(1)}" y2="${(H * f).toFixed(1)}"/>`).join('')}
      <line class="sim-zero" x1="0" x2="${W}" y1="${y0.toFixed(1)}" y2="${y0.toFixed(1)}"/>
      ${[1, 15, 30].map((d) => `<text class="sim-ax" x="${X(d).toFixed(1)}" y="${H + 2}" text-anchor="${d === 30 ? 'end' : d === 1 ? 'start' : 'middle'}">${d} พ.ย.</text>`).join('')}
      <path id="simArea" style="fill:url(#simGrad)" clip-path="url(#simPosC)"/>
      <path id="simNeg" class="sim-neg" clip-path="url(#simNegC)"/>
      <path id="simLineP" class="sim-line" clip-path="url(#simPosC)"/>
      <path id="simLineN" class="sim-line neg" clip-path="url(#simNegC)"/>
      <g id="simScrub" class="sim-scrub"><line y1="${PY - 6}" y2="${H - PY + 4}"/><circle id="simDot" r="5"/></g>
    </svg>` + EV.map((e, i) => `<span class="sim-pin ${e.v > 0 ? 'pos' : 'neg'}" id="simPin${i}">${e.v > 0 ? '+' : '−'}${baht(Math.abs(e.v))} ${e.name}</span>`).join('');
    const el = (id) => $(id);
    const areaEl = el('simArea'), negEl = el('simNeg'), lineP = el('simLineP'), lineN = el('simLineN'), scrub = el('simScrub'), dot = el('simDot');
    const pins = EV.map((_, i) => el('simPin' + i));

    // ไทม์ไลน์ (วินาที)
    const T = { items: 0.5, calc: 3.3, calcEnd: 10, ai: 10.5, press: 11.6, morph: 12, morphEnd: 13.4, end: 17.4, total: 18 };
    const BOUNDS = [[0, T.calc], [T.calc, T.calcEnd], [T.calcEnd, T.end]];
    let cache = {};
    const set = (key, val, fn) => { if (cache[key] !== val) { cache[key] = val; fn(val); } };

    function render(t) {
      const ph = t < T.calc ? 0 : t < T.calcEnd ? 1 : 2;
      steps.forEach((li, i) => {
        li.classList.toggle('on', reduced || i === ph);
        li.style.setProperty('--p', clamp01((t - BOUNDS[i][0]) / (BOUNDS[i][1] - BOUNDS[i][0])).toFixed(3));
      });
      chips.forEach((c, i) => c.classList.toggle('show', t >= T.items + i * 0.42));

      const day = t < T.calc ? 0 : Math.min(DAYS, ((t - T.calc) / (T.calcEnd - T.calc)) * DAYS);
      const m = ease(clamp01((t - T.morph) / (T.morphEnd - T.morph)));
      const S = A.map((v, i) => v + (B[i] - v) * m);
      const at = (d) => { const i = Math.floor(d); return i >= DAYS ? S[DAYS] : S[i] + (S[i + 1] - S[i]) * (d - i); };

      const pts = [];
      for (let i = 0; i <= Math.floor(day); i++) pts.push([X(i), Y(S[i])]);
      if (day % 1 > 0) pts.push([X(day), Y(at(day))]);
      const d = pts.length > 1 ? pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') : '';
      const area = d ? `${d} L${pts[pts.length - 1][0].toFixed(1)},${y0.toFixed(1)} L${X(0).toFixed(1)},${y0.toFixed(1)} Z` : '';
      lineP.setAttribute('d', d); lineN.setAttribute('d', d);
      areaEl.setAttribute('d', area); negEl.setAttribute('d', area);

      const scrubOn = t >= T.calc && t < T.calcEnd + 0.3;
      scrub.style.opacity = scrubOn ? 1 : 0;
      scrub.setAttribute('transform', `translate(${X(day).toFixed(1)},0)`);
      dot.setAttribute('cy', Y(at(day)).toFixed(1));
      dot.classList.toggle('neg', at(day) < 0);

      EV.forEach((e, i) => {
        const pin = pins[i];
        pin.classList.toggle('show', day >= e.d - 0.05);
        pin.classList.toggle('moved', !!e.laptop && t >= T.morph);
        const xp = (X(e.d) / W) * 100;
        pin.style.left = xp.toFixed(2) + '%';
        // รายรับ: ป้ายอยู่ใต้เส้น (ไม่ชนกับรายจ่ายที่อยู่ใกล้ ๆ) · ใกล้ขอบ: ชิดเข้าด้านใน
        pin.classList.toggle('below', e.v > 0);
        pin.dataset.edge = xp < 14 ? 'l' : xp > 86 ? 'r' : '';
        pin.style.top = (((e.v > 0 ? Y(S[e.d]) : Math.min(Y(S[e.d - 1]), Y(S[e.d]))) / H) * 100).toFixed(2) + '%';
      });
      laptopChip.classList.toggle('moved', t >= T.morph);

      let label, val;
      if (t < T.calc) { label = 'ยอดต้นเดือน'; val = START; }
      else if (t < T.calcEnd) { label = `ยอด ณ วันที่ ${Math.max(1, Math.ceil(day))} พ.ย.`; val = at(day); }
      else { label = 'คาดว่าจะเหลือสิ้นเดือน'; val = S[DAYS]; }
      set('big', baht(val), (v) => { big.textContent = v; });
      set('neg', val < 0, (v) => big.classList.toggle('neg', v));
      set('lab', label, (v) => { lab.textContent = v; });

      const fixed = m >= 0.5, crossed = day >= firstNeg;
      const status = t < T.calc ? 'wait' : fixed ? 'ok' : crossed ? 'short' : 'calc';
      set('chip', status, (s) => {
        chip.className = 'pm-chip' + (s === 'ok' ? ' ok' : s === 'short' ? ' short' : '');
        chip.textContent = { wait: 'รอคำนวณ', calc: 'กำลังคำนวณ…', short: 'ไม่พอ', ok: 'พอใช้' }[s];
      });
      set('call', status, (s) => {
        call.className = 'pm-call' + (s === 'short' ? ' short' : '');
        call.innerHTML = s === 'short'
          ? `เงินจะติดลบตั้งแต่ <b>${firstNeg} พ.ย.</b> ขาดมากสุด <b>${baht(-minA)}</b>`
          : s === 'ok' ? `ใช้นอกแผนได้อีกไม่เกิน <b>วันละ ${baht(safe)}</b> โดยยอดไม่ติดลบ` : '';
      });
      aiBox.classList.toggle('show', t >= T.ai);
      apply.classList.toggle('press', t >= T.press && t < T.press + 0.25);
      set('done', t >= T.morph, (v) => { apply.classList.toggle('done', v); apply.textContent = v ? 'ใช้คำแนะนำแล้ว ✓' : 'ใช้คำแนะนำนี้'; });
    }

    let t = 0, last = 0, raf = 0, vis = false;
    const frame = (now) => {
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
      last = now;
      t += dt;
      if (t > T.total) t = 0;
      render(t);
      raf = requestAnimationFrame(frame);
    };
    const update = () => {
      const run = vis && !document.hidden && !reduced;
      if (run && !raf) { last = 0; raf = requestAnimationFrame(frame); }
      else if (!run && raf) { cancelAnimationFrame(raf); raf = 0; }
    };
    const starts = [0, T.calc, T.calcEnd];
    steps.forEach((li, i) => li.addEventListener('click', () => { t = reduced ? [T.calc - 0.01, T.calcEnd - 0.01, T.end][i] : starts[i]; render(t); }));
    if (reduced) { render(T.end); return; }
    render(0);
    new IntersectionObserver(([e]) => { vis = e.isIntersecting; update(); }, { threshold: 0.35 }).observe(sim);
    document.addEventListener('visibilitychange', update);
  })();

  /* =====================================================================
     2) ฉากในการ์ดฟีเจอร์
  ===================================================================== */

  // 01 บันทึกในไม่กี่วินาที: พิมพ์จำนวนเงิน → เลือกหมวด → กดบันทึก → รายการใหม่เลื่อนเข้าลิสต์
  (function () {
    const st = $('sA');
    if (!st) return;
    const amt = $('recAmt'), cats = [...st.querySelectorAll('.rec-cats span')], save = $('recSave'), row = $('recNew'), timer = $('recTimer');
    const reset = () => {
      amt.textContent = '0'; cats.forEach((c) => c.classList.remove('sel')); save.classList.remove('press');
      row.classList.remove('show'); timer.classList.remove('done'); timer.textContent = '0.0 วิ';
    };
    scene(st, async (wait) => {
      reset();
      await wait(700);
      let secs = 0, ticking = true;
      (async () => { while (ticking) { await wait(100); if (!ticking) break; secs += 0.1; timer.textContent = secs.toFixed(1) + ' วิ'; } })();
      await wait(350); amt.textContent = '6';
      await wait(260); amt.textContent = '65';
      await wait(420); cats[1].classList.add('sel');
      await wait(260); cats[1].classList.remove('sel'); cats[0].classList.add('sel');
      await wait(520); save.classList.add('press');
      await wait(170); save.classList.remove('press');
      ticking = false;
      row.classList.add('show');
      timer.textContent = `บันทึกแล้ว ${secs.toFixed(1)} วินาที`; timer.classList.add('done');
      await wait(3600);
    }, () => { amt.textContent = '65'; cats[0].classList.add('sel'); row.classList.add('show'); timer.textContent = 'บันทึกแล้ว 2.1 วินาที'; timer.classList.add('done'); });
  })();

  // 02 วางแผน 12 เดือน: แท่งยอดสิ้นเดือนขึ้นทีละเดือน พ.ย. ติดลบ → ปรับแผนแล้วกลับมาเป็นบวก
  (function () {
    const st = $('sB');
    if (!st) return;
    const plot = $('mbPlot'), pin = $('mbPin');
    const M = ['ต.ค.', 'พ.ย.', 'ธ.ค.', 'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.'];
    const A = [17.2, -3.0, 2.7, 4.9, 6.8, 8.1, 9.6, 10.9, 12.3, 13.8, 15.0, 16.6];
    const B = [17.2, 9.0, 11.4, 4.9, 6.8, 8.1, 9.6, 10.9, 12.3, 13.8, 15.0, 16.6];
    const Z = 24, K = 66 / 17.2; // เส้นศูนย์อยู่สูงจากล่าง 24% · 1k = K%
    plot.insertAdjacentHTML('afterbegin', M.map((m, i) => `<div class="mb-col"><i class="mb-bar" style="--d:${(i * 0.06).toFixed(2)}s"></i><span class="mb-m">${m}</span></div>`).join(''));
    const bars = [...plot.querySelectorAll('.mb-bar')];
    const put = (b, v) => {
      const h = Math.abs(v) * K;
      b.style.bottom = (v >= 0 ? Z : Z - h) + '%';
      b.style.height = h + '%';
      b.classList.toggle('neg', v < 0);
    };
    const pinAt = (i, v, text, cls) => {
      pin.textContent = text;
      pin.className = 'mb-pin show ' + cls;
      pin.style.left = ((i + 0.5) / 12) * 100 + '%';
      pin.style.bottom = (v >= 0 ? Z + v * K : Z) + 4 + '%';
    };
    const reset = () => { bars.forEach((b) => { b.classList.remove('fix'); put(b, 0); }); pin.className = 'mb-pin'; };
    scene(st, async (wait) => {
      reset();
      await wait(500);
      bars.forEach((b, i) => put(b, A[i]));
      await wait(1500);
      pinAt(1, 0, 'พ.ย. −฿3.0k', 'neg');
      await wait(1700);
      bars.forEach((b) => { b.style.transitionDelay = '0s'; });
      put(bars[1], B[1]); put(bars[2], B[2]);
      bars[1].classList.add('fix'); bars[2].classList.add('fix');
      pinAt(1, B[1], 'ปรับแผนแล้ว +฿9.0k', 'ok');
      await wait(3200);
      bars.forEach((b) => { b.style.transitionDelay = ''; });
    }, () => { bars.forEach((b, i) => put(b, B[i])); bars[1].classList.add('fix'); pinAt(1, B[1], 'ปรับแผนแล้ว +฿9.0k', 'ok'); });
  })();

  // 03 Analytics: โดนัทวาดทีละส่วน ยอดรวมนับขึ้น แถบสัดส่วนยืดออก
  (function () {
    const st = $('sC');
    if (!st) return;
    const C = 2 * Math.PI * 44;
    const PARTS = [0.4, 0.34, 0.14, 0.12];
    const segs = [...st.querySelectorAll('.dn-seg')], total = $('dnTotal');
    let off = 0;
    const lens = PARTS.map((p) => { const o = off; off += p * C; return { len: Math.max(0, p * C - 2.5), o }; });
    segs.forEach((s, i) => { s.style.strokeDashoffset = (-lens[i].o).toFixed(2); });
    const draw = (on) => segs.forEach((s, i) => { s.style.strokeDasharray = on ? `${lens[i].len.toFixed(2)} ${C.toFixed(2)}` : `0 ${C.toFixed(2)}`; });
    scene(st, async (wait) => {
      draw(false); st.classList.remove('on'); total.textContent = '฿0';
      await wait(500);
      for (let i = 0; i < segs.length; i++) {
        segs[i].style.strokeDasharray = `${lens[i].len.toFixed(2)} ${C.toFixed(2)}`;
        if (i === 0) { st.classList.add('on'); count(total, 0, 8681, 1300, baht, wait); }
        await wait(260);
      }
      await wait(4200);
      draw(false); st.classList.remove('on');
      await wait(700);
    }, () => { draw(true); st.classList.add('on'); total.textContent = '฿8,681'; });
  })();

  // 04 AI สรุป: โครงร่างกำลังโหลด → หัวข้อพิมพ์ออกมา → ข้อสังเกตเลื่อนเข้าทีละข้อ
  (function () {
    const st = $('sD');
    if (!st) return;
    const box = $('insBox'), state = $('insState'), head = $('insHead'), rows = [...st.querySelectorAll('.ins-row')];
    const HEAD = 'เดือนนี้คุมค่ากินได้ดีขึ้น แต่งบเริ่มตึง';
    scene(st, async (wait) => {
      box.classList.add('loading'); state.textContent = 'กำลังวิเคราะห์…'; head.textContent = ''; rows.forEach((r) => r.classList.remove('show'));
      await wait(1500);
      box.classList.remove('loading'); state.textContent = 'วิเคราะห์เสร็จ · 3 ข้อ';
      await type(head, HEAD, wait, 32);
      for (const r of rows) { await wait(320); r.classList.add('show'); }
      await wait(3800);
    }, () => { box.classList.remove('loading'); state.textContent = 'วิเคราะห์เสร็จ · 3 ข้อ'; head.textContent = HEAD; rows.forEach((r) => r.classList.add('show')); });
  })();

  // 05 ถามได้ทุกเรื่อง: คำถาม → จุดกำลังพิมพ์ → คำตอบพิมพ์ทีละตัว
  (function () {
    const st = $('sE');
    if (!st) return;
    const q = $('chQ'), a = $('chA');
    const QA = [
      ['จะเก็บเงินหมื่นยังไงดี', 'เก็บเดือนละ ฿1,700 ครบใน 6 เดือน ลองลดช้อปปิ้งลงครึ่งหนึ่ง'],
      ['สัปดาห์นี้ใช้ไปเท่าไร', '฿1,245 ครับ น้อยกว่าสัปดาห์ก่อน ฿310 ดีมาก']
    ];
    let k = 0;
    scene(st, async (wait) => {
      const [qq, aa] = QA[k++ % QA.length];
      q.classList.remove('show'); a.classList.remove('show');
      await wait(450);
      q.textContent = qq; q.classList.add('show');
      await wait(650);
      a.innerHTML = '<span class="ad-dots"><i></i><i></i><i></i></span>'; a.classList.add('show');
      await wait(950);
      await type(a, aa, wait, 28);
      await wait(3000);
    }, () => { q.textContent = QA[0][0]; a.textContent = QA[0][1]; q.classList.add('show'); a.classList.add('show'); });
  })();

  // 06 คำแนะนำเมื่อใกล้ถึงงบ: เข็มหน้าปัดกวาดไปที่ 86% แล้วคำแนะนำเด้งขึ้นทีละข้อ
  (function () {
    const st = $('sF');
    if (!st) return;
    const val = $('ggVal'), needle = $('ggNeedle'), num = $('ggNum'), tips = [...st.querySelectorAll('.tip')];
    const L = 251.33, P = 0.86;
    const go = (p) => { val.style.strokeDashoffset = (L * (1 - p)).toFixed(2); needle.style.transform = `rotate(${(-90 + p * 180).toFixed(1)}deg)`; };
    scene(st, async (wait) => {
      go(0); num.textContent = '0%'; tips.forEach((t) => t.classList.remove('show'));
      await wait(600);
      go(P);
      await count(num, 0, 86, 1400, (v) => Math.round(v) + '%', wait);
      for (const t of tips) { await wait(380); t.classList.add('show'); }
      await wait(3600);
    }, () => { go(P); num.textContent = '86%'; tips.forEach((t) => t.classList.add('show')); });
  })();
})();
