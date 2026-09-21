/* analytics.js — แดชบอร์ดวิเคราะห์ในแท็บ "รายงาน" (Analytics)
   คำนวณทุกอย่างจาก state.txs ฝั่งหน้าเว็บ ไม่ต้องเรียก API เพิ่ม
   ใช้ของจากสคริปต์หลักใน app.html: state, lang, catName, catColorOf, catIcon, fmtMoneyShort,
   fmtAxis, niceStep, getBudgetForMonth, monthsTH, monthsEN, tweenNumber, escapeHtml, Motion
   เรียก Analytics.render() ได้ทุกเมื่อ — ถ้าแผงยังไม่แสดงบนจอจะรอวาดตอนเปิดดู */
(function () {
  const L = (th, en) => (lang === 'th' ? th : en);
  const DAY = 864e5;
  const RANGES = {
    '30d': { unit: 'day', n: 30, label: '30D' },
    '90d': { unit: 'week', n: 13, label: '90D' },
    '6m': { unit: 'week', n: 26, label: '6M' },
    '1y': { unit: 'week', n: 52, label: '1Y' },
    all: { unit: 'month', label: 'ALL' }
  };
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} }
  };
  const ax = { range: RANGES[store.get('mm-ax-range')] ? store.get('mm-ax-range') : '6m', flow: 'flow', mx: 'expense', builtLang: null };
  let uid = 0;

  /* ---------- helpers ---------- */
  const esc = (s) => escapeHtml(String(s));
  const sod = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const dkey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const money = (v) => (v < 0 ? '−' : '') + fmtMoneyShort(Math.abs(v));
  const months = () => (lang === 'th' ? monthsTH : monthsEN);
  const yearOf = (y) => (lang === 'th' ? y + 543 : y);
  const dLabel = (d) => (lang === 'th' ? `${d.getDate()} ${months()[d.getMonth()]}` : `${months()[d.getMonth()]} ${d.getDate()}`);
  const sum = (arr, f = (x) => x) => arr.reduce((s, x) => s + f(x), 0);
  const $ = (id) => document.getElementById(id);

  // สีหมวดหมู่ในแดชบอร์ด: หมวดที่ผู้ใช้สร้างเองได้โทนจากชื่อ ถ้าซ้ำกับหมวดอื่นในกราฟเดียวกันให้ขยับไปโทนถัดไป
  let colors = {};
  function assignColors(cats) {
    colors = {};
    const used = new Set();
    cats.forEach((c) => { if (catColor[c]) { colors[c] = catColor[c]; used.add(catColor[c]); } });
    cats.forEach((c) => {
      if (colors[c]) return;
      let i = catToneIndex(c), tone = `var(--cat-x${i})`;
      for (let k = 0; k < CUSTOM_CAT_TONES && used.has(tone); k++) tone = `var(--cat-x${(i + k + 1) % CUSTOM_CAT_TONES})`;
      used.add(tone);
      colors[c] = tone;
    });
  }
  const colorOf = (c) => colors[c] || catColorOf(c);

  // เส้นโค้งแบบ monotone (ไม่พุ่งเกินจุดข้อมูล)
  function smooth(pts) {
    const n = pts.length;
    if (!n) return '';
    if (n === 1) return `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    const dx = [], m = [], t = [];
    for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; m[i] = (pts[i + 1][1] - pts[i][1]) / (dx[i] || 1); }
    t[0] = m[0]; t[n - 1] = m[n - 2];
    for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
      const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
      if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
    }
    let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
    for (let i = 0; i < n - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], h = dx[i] / 3;
      d += ` C${(x0 + h).toFixed(1)},${(y0 + t[i] * h).toFixed(1)} ${(x1 - h).toFixed(1)},${(y1 - t[i + 1] * h).toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
    }
    return d;
  }

  function scale(lo, hi) {
    const step = niceStep((hi - lo) / 4 || 250);
    let top = Math.ceil(hi / step) * step, bottom = Math.floor(lo / step) * step;
    if (top <= bottom) top = bottom + step;
    return { top, bottom, step };
  }

  function gradient(id, color, a = 0.34) {
    return `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:${color};stop-opacity:${a}"/><stop offset="1" style="stop-color:${color};stop-opacity:0"/></linearGradient>`;
  }
  const glow = (id) => `<filter id="${id}" x="-10%" y="-40%" width="120%" height="180%"><feGaussianBlur stdDeviation="3.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;

  function spark(values, color, cls = 'ax-spark', W = 200, H = 46) {
    const n = values.length;
    const lo = Math.min(...values, 0), hi = Math.max(...values, 0), span = hi - lo || 1;
    const pts = values.map((v, i) => [n === 1 ? W / 2 : (i * W) / (n - 1), 4 + (H - 8) * (1 - (v - lo) / span)]);
    const id = 'axg' + ++uid, line = smooth(pts);
    return `<svg class="${cls}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true"><defs>${gradient(id, color, 0.32)}</defs>
      <path d="${line} L${W},${H} L0,${H} Z" style="fill:url(#${id})"/>
      <path d="${line}" fill="none" style="stroke:${color}" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/></svg>`;
  }

  function chip(el, d) {
    el.className = 'ax-chip' + (d && d.cls ? ' ' + d.cls : '');
    el.textContent = d ? d.text : '—';
  }
  function deltaPct(cur, prev, goodUp) {
    if (!prev) return cur ? { text: 'NEW', cls: '' } : null;
    const diff = cur - prev, p = Math.abs((diff / prev) * 100);
    return { text: `${diff >= 0 ? '↑' : '↓'} ${p >= 100 ? p.toFixed(0) : p.toFixed(1)}%`, cls: Math.abs(diff) < 0.5 ? '' : (diff > 0) === goodUp ? 'up' : 'down' };
  }
  function deltaAmt(cur, prev) {
    const diff = cur - prev;
    return { text: `${diff >= 0 ? '↑' : '↓'} ${fmtMoneyShort(Math.abs(diff))}`, cls: Math.abs(diff) < 0.5 ? '' : diff > 0 ? 'up' : 'down' };
  }

  /* ---------- data ---------- */
  function compute() {
    const r = RANGES[ax.range];
    const today = sod(new Date()), tomorrow = addDays(today, 1);
    const buckets = [];
    let firstTx = null;
    state.txs.forEach((x) => { if (!firstTx || x.date < firstTx) firstTx = x.date; });
    if (r.unit === 'month') {
      const first = firstTx && firstTx < today ? firstTx : today;
      const last = new Date(today.getFullYear(), today.getMonth(), 1);
      let m = new Date(first.getFullYear(), first.getMonth(), 1);
      const minStart = new Date(last.getFullYear(), last.getMonth() - 2, 1); // อย่างน้อย 3 เดือน
      if (m > minStart) m = minStart;
      while (m <= last) { const e = new Date(m.getFullYear(), m.getMonth() + 1, 1); buckets.push({ s: m, e }); m = e; }
    } else {
      const len = r.unit === 'day' ? 1 : 7, start = addDays(today, -(r.n * len - 1));
      for (let i = 0; i < r.n; i++) buckets.push({ s: addDays(start, i * len), e: addDays(start, (i + 1) * len) });
    }
    const start = buckets[0].s, end = buckets[buckets.length - 1].e;
    const prevStart = new Date(start.getTime() - (end - start));
    // เทียบกับช่วงก่อนหน้าเฉพาะเมื่อมีประวัติครอบคลุมช่วงนั้นจริง (ไม่งั้นจะได้ % เพี้ยน ๆ อย่าง +12500%)
    const hasPrev = r.unit !== 'month' && !!firstTx && firstTx <= addDays(prevStart, 3);
    const idxOf = r.unit === 'month'
      ? (d) => (d.getFullYear() - start.getFullYear()) * 12 + d.getMonth() - start.getMonth()
      : (d) => Math.floor(Math.round((sod(d) - start) / DAY) / (r.unit === 'day' ? 1 : 7));

    buckets.forEach((b) => Object.assign(b, { inc: 0, exp: 0, n: 0, cats: {}, icats: {} }));
    const cur = { inc: 0, exp: 0, n: 0, cats: {}, catN: {}, icats: {}, icatN: {}, titles: {}, big: null, days: {} };
    const prev = { inc: 0, exp: 0, cats: {}, icats: {} };
    let before = state.openingBalance;
    const add = (o, k, v) => { o[k] = (o[k] || 0) + v; };

    state.txs.slice().sort((a, b) => a.date - b.date).forEach((x) => {
      const d = x.date, isInc = x.type === 'income';
      if (d < start) {
        before += isInc ? x.amount : -x.amount;
        if (hasPrev && d >= prevStart) {
          if (isInc) { prev.inc += x.amount; add(prev.icats, x.cat, x.amount); }
          else { prev.exp += x.amount; add(prev.cats, x.cat, x.amount); }
        }
        return;
      }
      if (d >= end) return;
      const b = buckets[idxOf(d)];
      if (!b) return;
      b.n++; cur.n++;
      if (isInc) {
        b.inc += x.amount; cur.inc += x.amount;
        add(b.icats, x.cat, x.amount); add(cur.icats, x.cat, x.amount); add(cur.icatN, x.cat, 1);
      } else {
        b.exp += x.amount; cur.exp += x.amount;
        add(b.cats, x.cat, x.amount); add(cur.cats, x.cat, x.amount); add(cur.catN, x.cat, 1);
        add(cur.days, dkey(d), x.amount);
        const title = (x.title || '').trim() || catName(x.cat);
        const tk = title.toLowerCase();
        const t = cur.titles[tk] || (cur.titles[tk] = { title, total: 0, n: 0, cats: {} });
        t.total += x.amount; t.n++; add(t.cats, x.cat, 1);
        if (!cur.big || x.amount > cur.big.amount) cur.big = x;
      }
    });
    let bal = before;
    buckets.forEach((b) => { bal += b.inc - b.exp; b.bal = bal; });
    const rank = (o) => Object.keys(o).sort((a, b) => o[b] - o[a]);
    assignColors([...new Set([...rank(cur.cats), ...rank(cur.icats), ...Object.keys(prev.cats)])]);
    cur.balStart = before;

    const days = [];
    const effEnd = end < tomorrow ? end : tomorrow;
    // ช่วง "ทั้งหมด" นับวันตั้งแต่รายการแรก ไม่ใช่ต้นเดือนแรก
    const dayStart = r.unit === 'month' && firstTx && sod(firstTx) > start ? sod(firstTx) : start;
    for (let d = new Date(dayStart); d < effEnd; d = addDays(d, 1)) days.push({ d, v: cur.days[dkey(d)] || 0 });
    return { r, buckets, start, end, days, cur, prev, hasPrev };
  }

  function bucketTitle(b, unit) {
    if (unit === 'day') return dLabel(b.s);
    if (unit === 'week') return `${dLabel(b.s)} – ${dLabel(addDays(b.e, -1))}`;
    return `${months()[b.s.getMonth()]} ${yearOf(b.s.getFullYear())}`;
  }
  function bucketTick(b, unit, i) {
    if (unit !== 'month') return dLabel(b.s);
    const m = b.s.getMonth();
    return months()[m] + (m === 0 || i === 0 ? ` ${String(yearOf(b.s.getFullYear())).slice(-2)}` : '');
  }

  /* ---------- skeleton ---------- */
  const KPIS = [
    { id: 'net', label: 'NET FLOW', c: 'var(--accent)' },
    { id: 'exp', label: 'SPENT', c: 'var(--text-soft)' },
    { id: 'inc', label: 'INCOME', c: 'var(--text-soft)' },
    { id: 'rate', label: 'SAVINGS RATE', c: 'var(--text-soft)' }
  ];
  const TAG = { up: 'TREND', down: 'TREND', alert: 'ANOMALY', star: 'RECORD', streak: 'STREAK', piggy: 'SAVINGS' };

  function build(root) {
    const idx = (n) => `<span class="ax-idx">${String(n).padStart(2, '0')}</span>`;
    const head = (n, th, en, sub, tools = '') =>
      `<div class="ax-h">${idx(n)}<div class="ax-ht"><h3>${L(th, en)}</h3><div class="ax-en">${sub}</div></div>${tools ? `<div class="ax-tools">${tools}</div>` : ''}</div>`;
    root.innerHTML = `<div class="ax">
      <div class="ax-bar">
        <div class="ax-live"><i></i><span>LIVE</span><span class="ax-sep">/</span><span id="axStamp"></span></div>
        <div class="ax-range" id="axRange" role="tablist" aria-label="${L('ช่วงเวลา', 'Time range')}"><span class="pill"></span>
          ${Object.entries(RANGES).map(([k, r]) => `<button type="button" role="tab" data-r="${k}">${r.label}</button>`).join('')}
        </div>
      </div>
      <div class="ax-kpis">${KPIS.map((k) => `
        <div class="glass ax-kpi" style="--c:${k.c}">
          <div class="ax-kpi-top"><span class="ax-label">${k.label}</span><span class="ax-chip" id="axKd-${k.id}">—</span></div>
          <div class="ax-kpi-val" id="axKv-${k.id}">—</div>
          <div class="ax-kpi-sub" id="axKs-${k.id}"></div>
          <div class="ax-kpi-spark" id="axKp-${k.id}"></div>
        </div>`).join('')}
      </div>
      <div class="ax-grid">
        <section class="glass ax-card s8">
          ${head(1, 'กระแสเงินสด', 'Cash flow', 'CASH FLOW · <span id="axUnit"></span>',
            `<div class="ax-tabs" id="axFlowTabs"><button type="button" data-m="flow">${L('รับ-จ่าย', 'In / Out')}</button><button type="button" data-m="balance">${L('ยอดคงเหลือ', 'Balance')}</button></div>`)}
          <div class="ax-stats" id="axStats"></div>
          <div class="ax-legend-row" id="axFlowLegend"></div>
          <div class="ax-plot" id="axFlow"></div>
        </section>
        <section class="glass ax-card s4">
          ${head(2, 'สัดส่วนรายจ่าย', 'Spending mix', 'SPENDING MIX')}
          <div class="ax-mix" id="axMix"></div>
        </section>
        <section class="glass ax-card s7">
          ${head(3, 'จังหวะการใช้เงินเดือนนี้', 'Monthly pace', 'BUDGET PACE · <span id="axPaceMonth"></span>', '<span class="ax-chip" id="axPaceChip">—</span>')}
          <div class="ax-legend-row" id="axPaceLegend"></div>
          <div class="ax-plot" id="axPace"></div>
          <div class="ax-stats three" id="axPaceStats"></div>
        </section>
        <section class="glass ax-card s5 m6">
          ${head(4, 'ใช้จ่ายตามวันในสัปดาห์', 'Weekday pattern', 'AVG SPEND / WEEKDAY')}
          <div class="ax-week" id="axWeek"></div>
          <p class="ax-note" id="axWeekNote"></p>
        </section>
        <section class="glass ax-card s5 m6">
          ${head(5, 'จ่ายกับอะไรมากที่สุด', 'Top spending', 'TOP MERCHANTS')}
          <div class="ax-top" id="axTop"></div>
        </section>
        <section class="glass ax-card s7">
          ${head(6, 'ข้อสังเกตอัตโนมัติ', 'Auto insights', 'INSIGHTS')}
          <div class="ax-ins" id="axIns"></div>
        </section>
        <section class="glass ax-card">
          ${head(7, 'ตารางหมวดหมู่', 'Category matrix', 'CATEGORY MATRIX',
            `<div class="ax-tabs" id="axMxTabs"><button type="button" data-t="expense">${L('รายจ่าย', 'Expenses')}</button><button type="button" data-t="income">${L('รายรับ', 'Income')}</button></div>`)}
          <div class="ax-mx" id="axMx"></div>
        </section>
      </div>
    </div>`;

    $('axRange').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-r]');
      if (!b || b.dataset.r === ax.range) return;
      ax.range = b.dataset.r;
      store.set('mm-ax-range', ax.range);
      render();
    });
    $('axFlowTabs').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-m]');
      if (!b || b.dataset.m === ax.flow) return;
      ax.flow = b.dataset.m;
      render();
    });
    $('axMxTabs').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-t]');
      if (!b || b.dataset.t === ax.mx) return;
      ax.mx = b.dataset.t;
      render();
    });
    if (window.Motion) Motion.reveal(root.querySelectorAll('.ax-kpi, .ax-card'));
  }

  function placePill(group, btn, animate) {
    const pill = group.querySelector('.pill');
    if (!pill || !btn || !btn.offsetWidth) return;
    if (!animate) pill.style.transition = 'none';
    pill.style.width = btn.offsetWidth + 'px';
    pill.style.transform = `translateX(${btn.offsetLeft}px)`;
    if (!animate) { pill.offsetWidth; pill.style.transition = ''; }
  }

  /* ---------- KPI strip ---------- */
  function renderKpis(D) {
    const { cur, prev, hasPrev, buckets, days } = D;
    const net = cur.inc - cur.exp, pnet = prev.inc - prev.exp;
    const rate = cur.inc > 0 ? net / cur.inc : null, prate = prev.inc > 0 ? pnet / prev.inc : null;
    let ci = 0, ce = 0;
    const sNet = [], sRate = [];
    buckets.forEach((b) => { ci += b.inc; ce += b.exp; sNet.push(ci - ce); sRate.push(ci > 0 ? (ci - ce) / ci : null); });
    const firstRate = sRate.find((v) => v !== null);
    for (let i = 0; i < sRate.length && sRate[i] === null; i++) sRate[i] = firstRate === undefined ? 0 : firstRate;
    const srcCount = Object.keys(cur.icats).length;
    const vals = {
      net: { v: net, fmt: money, d: hasPrev ? deltaAmt(net, pnet) : null, s: sNet, sub: L('รายรับ − รายจ่ายในช่วงนี้', 'Income − expenses in range') },
      exp: { v: cur.exp, fmt: fmtMoneyShort, d: hasPrev ? deltaPct(cur.exp, prev.exp, false) : null, s: buckets.map((b) => b.exp),
        sub: L(`เฉลี่ย ${fmtMoneyShort(cur.exp / Math.max(1, days.length))} ต่อวัน`, `avg ${fmtMoneyShort(cur.exp / Math.max(1, days.length))} / day`) },
      inc: { v: cur.inc, fmt: fmtMoneyShort, d: hasPrev ? deltaPct(cur.inc, prev.inc, true) : null, s: buckets.map((b) => b.inc),
        sub: L(`จาก ${srcCount} แหล่งรายได้`, `from ${srcCount} source${srcCount === 1 ? '' : 's'}`) },
      rate: { v: rate, fmt: (x) => Math.round(x * 100) + '%', s: sRate, sub: L('ของรายรับที่เก็บไว้ได้', 'of income kept'),
        d: hasPrev && rate !== null && prate !== null
          ? (() => { const pp = (rate - prate) * 100; return { text: `${pp >= 0 ? '↑' : '↓'} ${Math.abs(pp).toFixed(1)} pp`, cls: Math.abs(pp) < 0.05 ? '' : pp > 0 ? 'up' : 'down' }; })()
          : null }
    };
    KPIS.forEach((k) => {
      const o = vals[k.id], el = $('axKv-' + k.id);
      if (o.v === null) { el._v = undefined; el.textContent = '—'; }
      else tweenNumber(el, o.v, o.fmt);
      el.classList.toggle('neg', k.id === 'net' && o.v < 0);
      chip($('axKd-' + k.id), o.d);
      $('axKs-' + k.id).textContent = o.sub;
      $('axKp-' + k.id).innerHTML = spark(o.s, k.c);
    });
  }

  /* ---------- 01 cash flow ---------- */
  function renderFlow(D) {
    const el = $('axFlow');
    const B = D.buckets, n = B.length, unit = D.r.unit, mode = ax.flow;
    const W = Math.max(300, Math.round(el.clientWidth) || 640), narrow = W < 560;
    const H = narrow ? 230 : 280, padL = 46, padR = 16, padT = 16, padB = 30;
    const plotW = W - padL - padR, plotH = H - padT - padB;
    const X = (i) => padL + (n === 1 ? plotW / 2 : (i * plotW) / (n - 1));
    const sc = mode === 'flow'
      ? scale(0, Math.max(...B.map((b) => Math.max(b.inc, b.exp)), 0))
      : scale(Math.min(0, ...B.map((b) => b.bal)), Math.max(...B.map((b) => b.bal), 0));
    const Y = (v) => padT + ((sc.top - v) / (sc.top - sc.bottom)) * plotH;
    const g = 'axf' + ++uid;

    $('axUnit').textContent = unit === 'day' ? 'DAILY' : unit === 'week' ? 'WEEKLY' : 'MONTHLY';
    let svg = `<defs>${gradient(g + 'i', 'var(--emerald)', 0.3)}${gradient(g + 'e', 'var(--coral)', 0.26)}${gradient(g + 'b', 'var(--accent)', 0.34)}${glow(g + 'f')}</defs>`;
    for (let v = sc.bottom; v <= sc.top + 1e-9; v += sc.step) {
      const yy = Y(v).toFixed(1);
      svg += `<line class="ax-gridline${Math.abs(v) < 1e-9 ? ' zero' : ''}" x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}"/><text class="ax-axis" x="${padL - 8}" y="${(+yy + 3.5).toFixed(1)}" text-anchor="end">${fmtAxis(v)}</text>`;
    }
    const every = Math.max(1, Math.ceil(n / (narrow ? 4 : 7)));
    B.forEach((b, i) => {
      if ((n - 1 - i) % every) return;
      svg += `<text class="ax-axis" x="${X(i).toFixed(1)}" y="${H - 8}" text-anchor="${i === n - 1 && n > 1 ? 'end' : i === 0 ? 'start' : 'middle'}">${bucketTick(b, unit, i)}</text>`;
    });

    const series = [];
    const base = Y(Math.max(sc.bottom, 0));
    const area = (pts, fill) => `<path d="${smooth(pts)} L${pts[pts.length - 1][0].toFixed(1)},${base.toFixed(1)} L${pts[0][0].toFixed(1)},${base.toFixed(1)} Z" style="fill:url(#${fill})"/>`;
    const line = (pts, color, extra = '') => `<path class="ax-line" d="${smooth(pts)}" style="stroke:${color}" filter="url(#${g}f)" ${extra}/>`;
    if (mode === 'flow') {
      const pi = B.map((b, i) => [X(i), Y(b.inc)]), pe = B.map((b, i) => [X(i), Y(b.exp)]);
      series.push({ c: 'var(--emerald)', pts: pi }, { c: 'var(--coral)', pts: pe });
      svg += `<g class="ax-series">${area(pi, g + 'i')}${area(pe, g + 'e')}${line(pi, 'var(--emerald)')}${line(pe, 'var(--coral)')}</g>`;
      const avg = D.cur.exp / n;
      if (avg > 0) {
        const ya = Y(avg).toFixed(1);
        svg += `<line class="ax-avg" x1="${padL}" x2="${W - padR}" y1="${ya}" y2="${ya}"/><text class="ax-axis ax-avg-t" x="${W - padR}" y="${(+ya - 6).toFixed(1)}" text-anchor="end">AVG ${fmtAxis(avg)}</text>`;
      }
    } else {
      const pb = B.map((b, i) => [X(i), Y(b.bal)]);
      series.push({ c: 'var(--accent)', pts: pb });
      svg += `<g class="ax-series">${area(pb, g + 'b')}${line(pb, 'var(--accent)', 'stroke-width="2.6"')}</g>`;
      let hi = 0, lo = 0;
      B.forEach((b, i) => { if (b.bal > B[hi].bal) hi = i; if (b.bal < B[lo].bal) lo = i; });
      [[hi, 'MAX', -10], [lo, 'MIN', 18]].forEach(([i, tag, dy]) => {
        if (n < 3 || (tag === 'MIN' && lo === hi)) return;
        svg += `<circle class="ax-mark" cx="${X(i).toFixed(1)}" cy="${Y(B[i].bal).toFixed(1)}" r="3.2"/><text class="ax-axis ax-mark-t" x="${X(i).toFixed(1)}" y="${(Y(B[i].bal) + dy).toFixed(1)}" text-anchor="middle">${tag} ${fmtAxis(B[i].bal)}</text>`;
      });
    }
    // จุดล่าสุดกระพริบ (ข้อมูลสด)
    series.forEach((s) => {
      const [lx, ly] = s.pts[s.pts.length - 1];
      svg += `<circle class="ax-pulse" cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="4" style="fill:${s.c}"/><circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="3.4" style="fill:${s.c}"/>`;
    });
    svg += `<g class="ax-cross"><line id="${g}x" x1="0" x2="0" y1="${padT}" y2="${padT + plotH}"/>${series.map((s, k) => `<circle id="${g}c${k}" r="5" style="stroke:${s.c}"/>`).join('')}</g>`;

    el.classList.remove('ready', 'hover');
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${L('กราฟกระแสเงินสด', 'Cash flow chart')}">${svg}</svg><div class="ax-tip"></div>`;
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('ready')));

    // legend + สถิติย่อ
    const net = D.cur.inc - D.cur.exp;
    $('axFlowLegend').innerHTML = mode === 'flow'
      ? `<span><i style="background:var(--emerald)"></i>${L('รายรับ', 'Income')}</span><span><i style="background:var(--coral)"></i>${L('รายจ่าย', 'Expenses')}</span><span><i class="dash"></i>${L('รายจ่ายเฉลี่ย', 'Avg spend')}</span><b class="${net < 0 ? 'neg' : ''}">NET ${net >= 0 ? '+' : ''}${money(net)}</b>`
      : `<span><i style="background:var(--accent)"></i>${L('ยอดคงเหลือ ณ สิ้นช่วง', 'Balance at period end')}</span><b>${money(B[n - 1].bal)}</b>`;
    const peak = D.days.reduce((a, d) => (d.v > a.v ? d : a), { v: 0, d: null });
    const zero = D.days.filter((d) => d.v === 0).length;
    $('axStats').innerHTML = [
      ['AVG / DAY', fmtMoneyShort(D.cur.exp / Math.max(1, D.days.length)), L('รายจ่ายเฉลี่ยต่อวัน', 'average daily spend')],
      ['TRANSACTIONS', D.cur.n.toLocaleString(), L(`${(D.cur.n / Math.max(1, D.days.length)).toFixed(1)} รายการ/วัน`, `${(D.cur.n / Math.max(1, D.days.length)).toFixed(1)} per day`)],
      ['PEAK DAY', peak.d ? fmtMoneyShort(peak.v) : '—', peak.d ? dLabel(peak.d) : L('ยังไม่มีรายจ่าย', 'no spending yet')],
      ['NO-SPEND', `${zero} ${L('วัน', 'days')}`, L(`จาก ${D.days.length} วัน`, `of ${D.days.length} days`)]
    ].map(([k, v, s]) => `<div class="ax-stat"><small>${k}</small><b>${v}</b><span>${s}</span></div>`).join('');

    // crosshair + tooltip
    const svgEl = el.querySelector('svg'), tip = el.querySelector('.ax-tip');
    const show = (clientX) => {
      const rect = svgEl.getBoundingClientRect(), k = rect.width / W;
      const sx = (clientX - rect.left) / k;
      const i = n === 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((sx - padL) / plotW) * (n - 1))));
      const b = B[i], x = X(i);
      const cross = $(g + 'x');
      cross.setAttribute('x1', x); cross.setAttribute('x2', x);
      series.forEach((s, j) => { const c = $(g + 'c' + j); c.setAttribute('cx', s.pts[i][0]); c.setAttribute('cy', s.pts[i][1]); });
      tip.innerHTML = `<div class="h">${bucketTitle(b, unit)}</div>` + (mode === 'flow'
        ? `<div class="r"><span><i style="background:var(--emerald)"></i>${L('รายรับ', 'Income')}</span><b>${fmtMoneyShort(b.inc)}</b></div>
           <div class="r"><span><i style="background:var(--coral)"></i>${L('รายจ่าย', 'Spent')}</span><b>${fmtMoneyShort(b.exp)}</b></div>
           <div class="r net"><span>NET</span><b class="${b.inc - b.exp < 0 ? 'neg' : 'pos'}">${b.inc - b.exp >= 0 ? '+' : ''}${money(b.inc - b.exp)}</b></div>`
        : `<div class="r"><span><i style="background:var(--accent)"></i>${L('ยอดคงเหลือ', 'Balance')}</span><b>${money(b.bal)}</b></div>
           <div class="r net"><span>${L('เปลี่ยนแปลง', 'Change')}</span><b class="${b.inc - b.exp < 0 ? 'neg' : 'pos'}">${b.inc - b.exp >= 0 ? '+' : ''}${money(b.inc - b.exp)}</b></div>`)
        + `<div class="r n"><span>${b.n} ${L('รายการ', 'transactions')}</span></div>`;
      const px = x * k, half = tip.offsetWidth / 2 + 6;
      tip.style.left = Math.max(half, Math.min(rect.width - half, px)) + 'px';
      el.classList.add('hover');
    };
    el.onpointermove = (e) => show(e.clientX);
    el.onpointerdown = (e) => show(e.clientX);
    el.onpointerleave = () => el.classList.remove('hover');
  }

  /* ---------- 02 spending mix (donut) ---------- */
  function renderMix(D) {
    const box = $('axMix'), total = D.cur.exp;
    let rows = Object.entries(D.cur.cats).map(([cat, v]) => ({ cat, v, c: colorOf(cat), name: esc(catName(cat)) })).sort((a, b) => b.v - a.v);
    if (rows.length > 6) {
      const rest = rows.slice(5);
      rows = rows.slice(0, 5);
      rows.push({ cat: '__rest', v: sum(rest, (r) => r.v), c: 'var(--text-faint)', name: L(`อีก ${rest.length} หมวด`, `${rest.length} more`) });
    }
    const R = 80, C = 2 * Math.PI * R, gap = rows.length > 1 ? 3 : 0;
    let off = 0;
    const segs = rows.map((r) => { const len = total ? (r.v / total) * C : 0; const s = { ...r, len: Math.max(0.5, len - gap), off }; off += len; return s; });
    const center = (label, value, sub) => `<small>${label}</small><b>${value}</b><span>${sub}</span>`;
    const def = center('TOTAL SPENT', fmtMoneyShort(total), total ? L(`${Object.keys(D.cur.cats).length} หมวดหมู่`, `${Object.keys(D.cur.cats).length} categories`) : L('ยังไม่มีรายจ่ายในช่วงนี้', 'No spending in range'));
    box.innerHTML = `<div class="ax-donut" id="axDonut">
        <svg viewBox="0 0 200 200" aria-hidden="true"><circle class="track" cx="100" cy="100" r="${R}"/>
          ${segs.map((s, i) => `<circle class="seg" data-i="${i}" cx="100" cy="100" r="${R}" style="stroke:${s.c};stroke-dasharray:0 ${C.toFixed(1)};stroke-dashoffset:${(-s.off).toFixed(1)}"/>`).join('')}
        </svg><div class="center" id="axDonutC">${def}</div></div>
      <div class="ax-legend">${segs.map((s, i) => `<div class="ax-leg" data-i="${i}" style="--c:${s.c}"><i></i><span class="n">${s.name}</span><span class="p">${((s.v / total) * 100).toFixed(1)}%</span><span class="v">${fmtMoneyShort(s.v)}</span></div>`).join('')}</div>`;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      box.querySelectorAll('circle.seg').forEach((c, i) => { c.style.strokeDasharray = `${segs[i].len.toFixed(1)} ${(C - segs[i].len).toFixed(1)}`; });
    }));
    const donut = $('axDonut'), cEl = $('axDonutC');
    const focus = (i) => {
      donut.classList.toggle('dim', i !== null);
      box.querySelectorAll('.seg, .ax-leg').forEach((el) => el.classList.toggle('on', i !== null && +el.dataset.i === i));
      cEl.innerHTML = i === null ? def : center(L('หมวด', 'CATEGORY'), fmtMoneyShort(segs[i].v), `${segs[i].name} · ${((segs[i].v / total) * 100).toFixed(1)}%`);
    };
    box.querySelectorAll('.seg, .ax-leg').forEach((el) => {
      el.addEventListener('pointerenter', () => focus(+el.dataset.i));
      el.addEventListener('pointerleave', () => focus(null));
    });
  }

  /* ---------- 03 monthly pace ---------- */
  function renderPace() {
    const el = $('axPace');
    const now = new Date(), y = now.getFullYear(), m = now.getMonth();
    const Dm = new Date(y, m + 1, 0).getDate(), today = now.getDate(), lastD = new Date(y, m, 0).getDate();
    const budget = getBudgetForMonth(y, m);
    const cum = Array(Dm + 1).fill(0), lcum = Array(lastD + 1).fill(0);
    const pm = new Date(y, m - 1, 1);
    state.txs.forEach((x) => {
      if (x.type !== 'expense') return;
      const d = x.date;
      if (d.getFullYear() === y && d.getMonth() === m) cum[d.getDate()] += x.amount;
      else if (d.getFullYear() === pm.getFullYear() && d.getMonth() === pm.getMonth()) lcum[d.getDate()] += x.amount;
    });
    for (let i = 1; i <= Dm; i++) cum[i] += cum[i - 1];
    for (let i = 1; i <= lastD; i++) lcum[i] += lcum[i - 1];
    const spent = cum[today], proj = (spent / today) * Dm;

    const W = Math.max(300, Math.round(el.clientWidth) || 560), H = W < 520 ? 200 : 220;
    const padL = 46, padR = 16, padT = 14, padB = 26, plotW = W - padL - padR, plotH = H - padT - padB;
    const sc = scale(0, Math.max(budget, proj, lcum[lastD], spent, 1) * 1.06);
    const X = (d) => padL + (d / Dm) * plotW, Y = (v) => padT + ((sc.top - v) / (sc.top - sc.bottom)) * plotH;
    const g = 'axp' + ++uid;
    let svg = `<defs>${gradient(g + 'a', 'var(--accent)', 0.32)}${glow(g + 'f')}</defs>`;
    for (let v = sc.bottom; v <= sc.top + 1e-9; v += sc.step) {
      const yy = Y(v).toFixed(1);
      svg += `<line class="ax-gridline" x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}"/><text class="ax-axis" x="${padL - 8}" y="${(+yy + 3.5).toFixed(1)}" text-anchor="end">${fmtAxis(v)}</text>`;
    }
    [1, 8, 15, 22, Dm].forEach((d) => { svg += `<text class="ax-axis" x="${X(d).toFixed(1)}" y="${H - 8}" text-anchor="${d === Dm ? 'end' : 'middle'}">${d}</text>`; });
    if (budget > 0) {
      svg += `<line class="ax-ideal" x1="${X(0)}" y1="${Y(0)}" x2="${X(Dm)}" y2="${Y(budget)}"/>`;
      svg += `<line class="ax-budget" x1="${padL}" x2="${W - padR}" y1="${Y(budget).toFixed(1)}" y2="${Y(budget).toFixed(1)}"/><text class="ax-axis ax-budget-t" x="${padL + 6}" y="${(Y(budget) - 6).toFixed(1)}">BUDGET ${fmtAxis(budget)}</text>`;
    }
    const lp = []; for (let d = 0; d <= Math.min(lastD, Dm); d++) lp.push([X(d), Y(lcum[d])]);
    svg += `<path class="ax-last" d="${smooth(lp)}"/>`;
    const ap = []; for (let d = 0; d <= today; d++) ap.push([X(d), Y(cum[d])]);
    svg += `<g class="ax-series"><path d="${smooth(ap)} L${X(today).toFixed(1)},${Y(0).toFixed(1)} L${X(0)},${Y(0).toFixed(1)} Z" style="fill:url(#${g}a)"/>
      <path class="ax-line" d="${smooth(ap)}" style="stroke:var(--accent)" filter="url(#${g}f)" stroke-width="2.6"/></g>`;
    if (today < Dm) svg += `<line class="ax-proj" x1="${X(today).toFixed(1)}" y1="${Y(spent).toFixed(1)}" x2="${X(Dm).toFixed(1)}" y2="${Y(proj).toFixed(1)}"/><circle class="ax-proj-end" cx="${X(Dm).toFixed(1)}" cy="${Y(proj).toFixed(1)}" r="3.5"/>`;
    svg += `<line class="ax-today" x1="${X(today).toFixed(1)}" x2="${X(today).toFixed(1)}" y1="${padT}" y2="${padT + plotH}"/>
      <text class="ax-axis ax-today-t" x="${X(today).toFixed(1)}" y="${padT - 3}" text-anchor="middle">${L('วันนี้', 'TODAY')}</text>
      <circle class="ax-pulse" cx="${X(today).toFixed(1)}" cy="${Y(spent).toFixed(1)}" r="4" style="fill:var(--accent)"/><circle cx="${X(today).toFixed(1)}" cy="${Y(spent).toFixed(1)}" r="3.6" style="fill:var(--accent)"/>`;
    el.classList.remove('ready');
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${L('กราฟจังหวะการใช้เงินเดือนนี้', 'Monthly spending pace chart')}">${svg}</svg>`;
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('ready')));

    $('axPaceMonth').textContent = `${months()[m].toUpperCase()} ${yearOf(y)}`;
    $('axPaceLegend').innerHTML = `<span><i style="background:var(--accent)"></i>${L('เดือนนี้', 'This month')}</span><span><i class="dash acc"></i>${L('คาดการณ์', 'Forecast')}</span><span><i class="dash soft"></i>${L('เดือนก่อน', 'Last month')}</span>${budget > 0 ? `<span><i class="dash amber"></i>${L('งบ', 'Budget')}</span>` : ''}`;
    const left = budget - spent, daysLeft = Dm - today;
    let st;
    if (budget <= 0) st = { text: L('ยังไม่ได้ตั้งงบ', 'No budget set'), cls: '' };
    else if (proj > budget) st = { text: L(`คาดว่าเกินงบ ~${fmtMoneyShort(proj - budget)}`, `Over by ~${fmtMoneyShort(proj - budget)}`), cls: 'down' };
    else if (spent > (budget * today) / Dm * 1.05) st = { text: L('ใช้เร็วกว่าแผน', 'Ahead of pace'), cls: 'warn' };
    else st = { text: L('อยู่ในแผน', 'On track'), cls: 'up' };
    chip($('axPaceChip'), st);
    $('axPaceStats').innerHTML = [
      ['SPENT', fmtMoneyShort(spent), budget > 0 ? L(`${Math.round((spent / budget) * 100)}% ของงบ`, `${Math.round((spent / budget) * 100)}% of budget`) : L(`ถึงวันที่ ${today}`, `through day ${today}`)],
      ['FORECAST', fmtMoneyShort(proj), L('ถ้าใช้ในอัตรานี้ถึงสิ้นเดือน', 'at the current rate')],
      ['SAFE / DAY', budget > 0 && daysLeft > 0 ? (left > 0 ? fmtMoneyShort(left / daysLeft) : '฿0') : '—', budget > 0 ? (daysLeft > 0 ? L(`อีก ${daysLeft} วัน`, `${daysLeft} days left`) : L('วันสุดท้ายของเดือน', 'last day of month')) : L('ตั้งงบในหน้าหลักได้', 'set a budget on Home')]
    ].map(([k, v, s]) => `<div class="ax-stat"><small>${k}</small><b>${v}</b><span>${s}</span></div>`).join('');
  }

  /* ---------- 04 weekday pattern ---------- */
  function renderWeek(D) {
    const tot = Array(7).fill(0), cnt = Array(7).fill(0);
    D.days.forEach(({ d, v }) => { const w = (d.getDay() + 6) % 7; tot[w] += v; cnt[w]++; });
    const avg = tot.map((t, i) => (cnt[i] ? t / cnt[i] : 0));
    const max = Math.max(...avg), peak = avg.indexOf(max);
    const short = L(['จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.', 'อา.'], ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    const full = L(['จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์', 'อาทิตย์'], ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
    const box = $('axWeek');
    box.classList.remove('ready');
    box.innerHTML = avg.map((v, i) => `<div class="ax-wk${max > 0 && i === peak ? ' max' : ''}${i >= 5 ? ' we' : ''}" style="--h:${max ? ((v / max) * 100).toFixed(1) : 0}%;--o:${max ? (0.35 + 0.65 * (v / max)).toFixed(2) : 0.3};--d:${(i * 0.05).toFixed(2)}s">
        <span class="v">${fmtAxis(v)}</span><div class="col"><i></i></div><span class="d">${short[i]}</span></div>`).join('');
    requestAnimationFrame(() => requestAnimationFrame(() => box.classList.add('ready')));
    const wd = sum(avg.slice(0, 5)) / 5, we = sum(avg.slice(5)) / 2;
    const note = $('axWeekNote');
    if (!max) { note.textContent = L('ยังไม่มีรายจ่ายในช่วงนี้', 'No spending in this range yet'); return; }
    const diff = wd ? (we / wd - 1) * 100 : 0;
    note.innerHTML = L(
      `ใช้มากสุดวัน<b>${full[peak]}</b> เฉลี่ย ${fmtMoneyShort(max)} · วันหยุดใช้${diff >= 0 ? 'มากกว่า' : 'น้อยกว่า'}วันธรรมดา <b>${Math.abs(diff).toFixed(0)}%</b>`,
      `Peak on <b>${full[peak]}</b> at ${fmtMoneyShort(max)} avg · weekends are <b>${Math.abs(diff).toFixed(0)}% ${diff >= 0 ? 'higher' : 'lower'}</b> than weekdays`);
  }

  /* ---------- 05 top spending ---------- */
  function renderTop(D) {
    const list = Object.values(D.cur.titles).sort((a, b) => b.total - a.total).slice(0, 6);
    const box = $('axTop');
    if (!list.length) { box.innerHTML = `<p class="ax-empty">${L('ยังไม่มีรายจ่ายในช่วงนี้', 'No spending in this range yet')}</p>`; return; }
    const top = list[0].total;
    box.innerHTML = list.map((t, i) => {
      const cat = Object.entries(t.cats).sort((a, b) => b[1] - a[1])[0][0];
      return `<div class="ax-top-row" style="--c:${colorOf(cat)};--w:${((t.total / top) * 100).toFixed(1)}%;--d:${(i * 0.06).toFixed(2)}s">
        <span class="rk">${String(i + 1).padStart(2, '0')}</span>
        <div class="tt"><span class="t">${esc(t.title)}</span><span class="m">${t.n} ${L('ครั้ง', t.n === 1 ? 'time' : 'times')} · ${L('เฉลี่ย', 'avg')} ${fmtMoneyShort(t.total / t.n)}</span></div>
        <span class="a">${fmtMoneyShort(t.total)}</span>
        <div class="bar"><i></i></div></div>`;
    }).join('');
  }

  /* ---------- 06 insights ---------- */
  function renderInsights(D) {
    const { cur, prev, hasPrev, days } = D;
    const out = [];
    const range = L({ '30d': '30 วัน', '90d': '90 วัน', '6m': '6 เดือน', '1y': '1 ปี', all: 'ทั้งหมด' }[ax.range], { '30d': '30 days', '90d': '90 days', '6m': '6 months', '1y': '1 year', all: 'all time' }[ax.range]);
    if (hasPrev) {
      let best = null;
      const base = Math.max(cur.exp, prev.exp, 1);
      Object.keys({ ...cur.cats, ...prev.cats }).forEach((c) => {
        const a = cur.cats[c] || 0, b = prev.cats[c] || 0;
        if (!b || Math.max(a, b) / base < 0.06) return;
        const ch = (a - b) / b;
        if (!best || Math.abs(ch) > Math.abs(best.ch)) best = { c, ch, a, b };
      });
      if (best && Math.abs(best.ch) >= 0.1) {
        const upx = best.ch > 0, p = Math.abs(best.ch * 100).toFixed(0), nm = esc(catName(best.c));
        out.push({ ic: upx ? 'up' : 'down', tone: upx ? 'neg' : 'pos', v: `${upx ? '+' : '−'}${p}%`,
          t: L(`หมวด<b>${nm}</b>${upx ? 'เพิ่มขึ้น' : 'ลดลง'} ${p}%`, `<b>${nm}</b> ${upx ? 'up' : 'down'} ${p}%`),
          p: L(`${fmtMoneyShort(best.a)} เทียบกับ ${fmtMoneyShort(best.b)} ในช่วงก่อนหน้า`, `${fmtMoneyShort(best.a)} vs ${fmtMoneyShort(best.b)} in the previous period`) });
      }
    }
    const vals = days.map((d) => d.v), mean = sum(vals) / Math.max(1, vals.length);
    const sd = Math.sqrt(sum(vals, (v) => (v - mean) ** 2) / Math.max(1, vals.length));
    const spikes = days.filter((d) => d.v > 0 && d.v > mean + 2 * sd);
    if (spikes.length && days.length >= 7) {
      const top = spikes.reduce((a, d) => (d.v > a.v ? d : a));
      out.push({ ic: 'alert', v: fmtMoneyShort(top.v),
        t: L(`พบ <b>${spikes.length} วัน</b>ที่ใช้จ่ายสูงผิดปกติ`, `<b>${spikes.length} unusual</b> spending day${spikes.length > 1 ? 's' : ''}`),
        p: L(`สูงสุด ${dLabel(top.d)} — ${fmtMoneyShort(top.v)} (ปกติวันละ ~${fmtMoneyShort(mean)})`, `Highest on ${dLabel(top.d)} — ${fmtMoneyShort(top.v)} (typical ~${fmtMoneyShort(mean)}/day)`) });
    }
    if (cur.inc > 0) {
      const r = Math.round(((cur.inc - cur.exp) / cur.inc) * 100);
      const pr = hasPrev && prev.inc > 0 ? Math.round(((prev.inc - prev.exp) / prev.inc) * 100) : null;
      out.push({ ic: 'piggy', tone: r >= 0 ? '' : 'neg', v: `${r}%`,
        t: r >= 0 ? L(`เก็บเงินได้ <b>${r}%</b> ของรายรับ`, `You kept <b>${r}%</b> of your income`) : L(`ใช้เกินรายรับ <b>${-r}%</b>`, `Spent <b>${-r}%</b> more than you earned`),
        p: pr !== null ? L(`ช่วงก่อนหน้า ${pr}% · ช่วงนี้ ${range}`, `Previous period ${pr}% · range ${range}`) : L('เป้าหมายที่นิยมคือเก็บให้ได้ 20% ขึ้นไป', 'A common goal is 20% or more') });
    }
    if (cur.big) {
      out.push({ ic: 'star', v: fmtMoneyShort(cur.big.amount),
        t: L(`รายจ่ายก้อนใหญ่สุด: <b>${esc(cur.big.title || catName(cur.big.cat))}</b>`, `Biggest expense: <b>${esc(cur.big.title || catName(cur.big.cat))}</b>`),
        p: `${fmtMoneyShort(cur.big.amount)} · ${esc(catName(cur.big.cat))} · ${dLabel(cur.big.date)}` });
    }
    if (days.length >= 7) {
      let best = 0, run = 0, zero = 0;
      days.forEach((d) => { if (d.v === 0) { run++; zero++; } else run = 0; best = Math.max(best, run); });
      out.push({ ic: 'streak', v: `${best}${L(' วัน', 'd')}`,
        t: L(`ไม่ใช้เงินติดกันนานสุด <b>${best} วัน</b>`, `Longest no-spend streak: <b>${best} day${best === 1 ? '' : 's'}</b>`),
        p: L(`มีวันที่ไม่ใช้เงินเลย ${zero} วันจาก ${days.length} วัน`, `${zero} no-spend days out of ${days.length}`) });
    }
    const box = $('axIns');
    box.innerHTML = out.length
      ? out.slice(0, 5).map((o, i) => `<div class="ax-in" style="--d:${(i * 0.07).toFixed(2)}s">
          <span class="k">${String(i + 1).padStart(2, '0')}</span>
          <div class="body"><span class="tag">${TAG[o.ic]}</span><div class="tt">${o.t}</div><p>${o.p}</p></div>
          <span class="v ${o.tone || ''}">${o.v}</span></div>`).join('')
      : `<p class="ax-empty">${L('เพิ่มรายการอีกสักหน่อย แล้วระบบจะสรุปข้อสังเกตให้', 'Add a few more transactions to unlock insights')}</p>`;
  }

  /* ---------- 07 category matrix ---------- */
  function renderMatrix(D) {
    document.querySelectorAll('#axMxTabs button').forEach((b) => b.classList.toggle('active', b.dataset.t === ax.mx));
    const isExp = ax.mx === 'expense';
    const src = isExp ? D.cur.cats : D.cur.icats, cnt = isExp ? D.cur.catN : D.cur.icatN, prevSrc = isExp ? D.prev.cats : D.prev.icats;
    const total = isExp ? D.cur.exp : D.cur.inc;
    const rows = Object.entries(src).sort((a, b) => b[1] - a[1]);
    const box = $('axMx');
    if (!rows.length) { box.innerHTML = `<p class="ax-empty">${L('ยังไม่มีข้อมูลในช่วงนี้', 'No data in this range yet')}</p>`; return; }
    // ลดจำนวนจุดของเส้นแนวโน้มให้ไม่เกิน ~26 จุด
    const B = D.buckets, step = Math.ceil(B.length / 26);
    const series = (cat) => {
      const out = [];
      for (let i = 0; i < B.length; i += step) out.push(sum(B.slice(i, i + step), (b) => (isExp ? b.cats : b.icats)[cat] || 0));
      return out;
    };
    box.innerHTML = `<div class="ax-mx-row head"><span>${L('หมวดหมู่', 'Category')}</span><span class="r">${L('ยอดรวม', 'Total')}</span><span class="w">${L('สัดส่วน', 'Share')}</span><span class="r w2">${L('ครั้ง', 'Count')}</span><span class="r w2">${L('เฉลี่ย/ครั้ง', 'Avg / tx')}</span><span>${L('แนวโน้ม', 'Trend')}</span><span class="r">${L('เทียบช่วงก่อน', 'vs prev')}</span></div>`
      + rows.map(([cat, v], i) => {
        const c = colorOf(cat), share = total ? (v / total) * 100 : 0;
        const d = D.hasPrev ? deltaPct(v, prevSrc[cat] || 0, !isExp) : null;
        return `<div class="ax-mx-row" style="--c:${c};--d:${(i * 0.04).toFixed(2)}s">
          <span class="cat"><span class="ic">${catIcon(cat)}</span><span class="nm">${esc(catName(cat))}</span></span>
          <span class="r num">${fmtMoneyShort(v)}</span>
          <span class="w share"><span class="bar"><i style="width:${share.toFixed(1)}%"></i></span><span class="num">${share.toFixed(1)}%</span></span>
          <span class="r num w2">${cnt[cat] || 0}</span>
          <span class="r num w2">${fmtMoneyShort(v / Math.max(1, cnt[cat] || 0))}</span>
          <span class="trend">${spark(series(cat), c, 'ax-mini', 120, 28)}</span>
          <span class="r"><span class="ax-chip ${d ? d.cls : ''}">${d ? d.text : '—'}</span></span>
        </div>`;
      }).join('');
  }

  /* ---------- entry ---------- */
  function render() {
    const root = $('paneAnalytics');
    if (!root || root.hidden || !state.user || !$('view-reports').classList.contains('active')) return;
    if (ax.builtLang !== lang) { build(root); ax.builtLang = lang; }
    const D = compute();
    const now = new Date();
    $('axStamp').textContent = L('อัปเดต ', 'UPDATED ') + now.toLocaleTimeString(lang === 'th' ? 'th-TH' : 'en-US', { hour: '2-digit', minute: '2-digit' });
    const rangeBox = $('axRange');
    rangeBox.querySelectorAll('button').forEach((b) => { const on = b.dataset.r === ax.range; b.classList.toggle('active', on); b.setAttribute('aria-selected', String(on)); });
    placePill(rangeBox, rangeBox.querySelector('button.active'), rangeBox.dataset.placed === '1');
    rangeBox.dataset.placed = '1';
    document.querySelectorAll('#axFlowTabs button').forEach((b) => b.classList.toggle('active', b.dataset.m === ax.flow));
    renderKpis(D);
    renderFlow(D);
    renderMix(D);
    renderPace();
    renderWeek(D);
    renderTop(D);
    renderInsights(D);
    renderMatrix(D);
  }

  window.Analytics = { render, placePill };
})();
