/* planner.js — วางแผนการเงินล่วงหน้า (หน้า "วางแผน")
   ผู้ใช้ใส่รายรับ/รายจ่ายที่คาดไว้ (ทุกวัน / ทุกสัปดาห์ / ทุกเดือน / ครั้งเดียว) แล้วระบบไล่คำนวณยอดเงินทีละวัน
   ตั้งแต่พรุ่งนี้ไปอีก 12 เดือน เพื่อบอกว่าแต่ละเดือนเงินพอไหม เหลือเท่าไร และจะติดลบวันไหน
   - ยอดตั้งต้น = ยอดคงเหลือจริงตอนนี้ (ยอดตั้งต้นในโปรไฟล์ + ทุกรายการจนถึงวันนี้)
   - รายการในแผนที่ถึงกำหนดวันนี้หรือก่อนหน้าถือว่าบันทึกเป็นรายการจริงไปแล้ว จึงนับจากพรุ่งนี้
   - รายการจริงที่ลงวันที่ล่วงหน้าไว้ก็นับรวมในวันนั้นด้วย
   ใช้ของจากสคริปต์หลักใน app.html: state, lang, t, catIcon, catColorOf, catMonogram, CAT_ICONS, fmtMoneyShort,
   fmtAxis, niceStep, monthsTH, monthsEN, escapeHtml, showToast, tweenNumber, Motion */
(function () {
  const L = (th, en) => (lang === 'th' ? th : en);
  const $ = (id) => document.getElementById(id);
  const esc = (s) => escapeHtml(String(s));
  const DAY = 864e5;
  const HORIZON = 12; // เดือน
  const sod = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const dkey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const months = () => (lang === 'th' ? monthsTH : monthsEN);
  const yearOf = (y) => (lang === 'th' ? y + 543 : y);
  const money = (v) => (v < 0 ? '−' : '') + fmtMoneyShort(Math.abs(v));
  const compact = (v) => (v < 0 ? '−' : '') + '฿' + fmtAxis(Math.abs(v));
  const dLabel = (d) => (lang === 'th' ? `${d.getDate()} ${months()[d.getMonth()]}` : `${months()[d.getMonth()]} ${d.getDate()}`);
  const monthTitle = (d) => `${months()[d.getMonth()]} ${yearOf(d.getFullYear())}`;
  const WEEKDAYS = () => L(['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'], ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']);
  const WD_SHORT = () => L(['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'], ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  const parseDate = (s) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  const isoDate = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  let uid = 0;
  let selK = 0; // เดือนที่เลือก (0 = เดือนนี้)
  let builtLang = null;

  /* ---------- กฎของรายการในแผน ---------- */
  function occurs(it, d) {
    if (it.freq === 'daily') return true;
    if (it.freq === 'weekly') return d.getDay() === it.day;
    if (it.freq === 'monthly') {
      const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      return d.getDate() === Math.min(it.day, dim);
    }
    return !!it._date && it._date.getTime() === d.getTime();
  }
  function ruleText(it) {
    if (it.freq === 'daily') return L('ทุกวัน', 'Every day');
    if (it.freq === 'weekly') return L(`ทุกวัน${WEEKDAYS()[it.day]}`, `Every ${WEEKDAYS()[it.day]}`);
    if (it.freq === 'monthly') return L(`ทุกวันที่ ${it.day} ของเดือน`, `Monthly on day ${it.day}`);
    const d = parseDate(it.on_date);
    return d ? L(`ครั้งเดียว · ${dLabel(d)} ${yearOf(d.getFullYear())}`, `Once · ${dLabel(d)} ${d.getFullYear()}`) : '';
  }
  // ยอดเทียบต่อเดือน (ใช้สรุปภาระประจำ)
  const perMonth = (it) => (it.freq === 'daily' ? it.amount * 30.4 : it.freq === 'weekly' ? it.amount * 4.35 : it.freq === 'monthly' ? it.amount : 0);
  const itemIcon = (it) => (it.cat && CAT_ICONS[it.cat] ? catIcon(it.cat) : `<span class="mono">${catMonogram(it.name)}</span>`);
  const itemTone = (it) => (it.cat ? catColorOf(it.cat) : catColorOf(it.name));

  function items() {
    return (state.plan || []).map((x) => ({ ...x, amount: parseFloat(x.amount) || 0, day: x.day === null || x.day === undefined ? null : +x.day, _date: parseDate(x.on_date) }));
  }

  /* ---------- คำนวณยอดล่วงหน้า ---------- */
  function project() {
    const plan = items();
    const today = sod(new Date()), tomorrow = addDays(today, 1);
    const end = new Date(today.getFullYear(), today.getMonth() + HORIZON, 1);
    let balNow = state.openingBalance;
    const future = {};
    state.txs.forEach((x) => {
      const v = x.type === 'income' ? x.amount : -x.amount;
      if (x.date < tomorrow) balNow += v;
      else if (x.date < end) (future[dkey(x.date)] = future[dkey(x.date)] || []).push(x);
    });
    const days = [];
    let bal = balNow;
    for (let d = new Date(tomorrow); d < end; d = addDays(d, 1)) {
      let inc = 0, exp = 0;
      const ev = [];
      plan.forEach((it) => {
        if (!occurs(it, d)) return;
        if (it.type === 'income') inc += it.amount; else exp += it.amount;
        ev.push({ it, amount: it.amount, type: it.type });
      });
      (future[dkey(d)] || []).forEach((x) => {
        if (x.type === 'income') inc += x.amount; else exp += x.amount;
        ev.push({ tx: x, amount: x.amount, type: x.type });
      });
      bal += inc - exp;
      days.push({ d: new Date(d), inc, exp, bal, ev });
    }
    return { plan, today, balNow, days };
  }

  function monthSummary(P, k) {
    const base = P.today;
    const ms = new Date(base.getFullYear(), base.getMonth() + k, 1), me = new Date(base.getFullYear(), base.getMonth() + k + 1, 1);
    const ds = P.days.filter((x) => x.d >= ms && x.d < me);
    const before = P.days.filter((x) => x.d < ms);
    const start = k === 0 || !before.length ? P.balNow : before[before.length - 1].bal;
    let inc = 0, exp = 0, min = start, minDay = null, firstNeg = null, safe = Infinity;
    ds.forEach((x, i) => {
      inc += x.inc; exp += x.exp;
      if (x.bal < min) { min = x.bal; minDay = x.d; }
      if (x.bal < 0 && !firstNeg) firstNeg = x.d;
      safe = Math.min(safe, x.bal / (i + 1)); // ใช้เพิ่มวันละเท่านี้แล้วยอดไม่ติดลบวันไหนเลย
    });
    if (!ds.length) safe = 0;
    safe = Math.max(0, safe);
    const endBal = start + inc - exp;
    // รวมรายการของเดือน: รายการตามวันที่ แยกกับรายการรายวัน/รายสัปดาห์ที่สรุปเป็นยอดรวม
    const dated = [], repeat = {};
    ds.forEach((x) => x.ev.forEach((e) => {
      if (e.it && (e.it.freq === 'daily' || e.it.freq === 'weekly')) {
        const r = repeat[e.it.id] || (repeat[e.it.id] = { it: e.it, n: 0, total: 0 });
        r.n++; r.total += e.amount;
      } else dated.push({ d: x.d, ...e });
    }));
    let status = 'ok';
    if (firstNeg) status = 'short';
    else if (endBal < Math.max(500, exp * 0.1)) status = 'tight';
    return { k, ms, me, ds, start, inc, exp, endBal, min, minDay, firstNeg, safe, dated, repeat: Object.values(repeat), status, days: ds.length };
  }

  // ค่ากินเฉลี่ยต่อวันจากประวัติ 30 วันล่าสุด (ใช้แนะนำตอนยังไม่มีรายจ่ายรายวันในแผน)
  function avgDailyFood() {
    const from = addDays(sod(new Date()), -30);
    const tot = state.txs.filter((x) => x.type === 'expense' && x.cat === 'food' && x.date >= from).reduce((s, x) => s + x.amount, 0);
    return Math.round(tot / 30 / 5) * 5;
  }

  const STATUS = {
    ok: { chip: 'up', th: 'พอใช้', en: 'On track' },
    tight: { chip: 'warn', th: 'ตึงมือ', en: 'Tight' },
    short: { chip: 'down', th: 'ไม่พอ', en: 'Short' }
  };

  /* ---------- โครงหน้า ---------- */
  function build(root) {
    root.innerHTML = `<div class="pl">
      <div class="pl-months" id="plMonths" role="tablist" aria-label="${L('เลือกเดือน', 'Choose month')}"></div>
      <div class="pl-grid">
        <section class="glass pl-card pl-hero s5" id="plHero"></section>
        <section class="glass pl-card s7">
          <div class="ax-h"><span class="ax-idx">01</span><div class="ax-ht"><h3>${L('ยอดเงินตลอดเดือน', 'Balance through the month')}</h3><div class="ax-en">BALANCE PROJECTION · <span id="plChartMonth"></span></div></div></div>
          <div class="ax-legend-row" id="plLegend"></div>
          <div class="ax-plot" id="plChart"></div>
        </section>
        <section class="glass pl-card s7">
          <div class="ax-h"><span class="ax-idx">02</span><div class="ax-ht"><h3 id="plListTitle"></h3><div class="ax-en">SCHEDULE</div></div><div class="ax-tools"><span class="pl-note" id="plListNote"></span></div></div>
          <div id="plSchedule"></div>
        </section>
        <section class="glass pl-card s5">
          <div class="ax-h"><span class="ax-idx">03</span><div class="ax-ht"><h3>${L('แผนของคุณ', 'Your plan')}</h3><div class="ax-en">RECURRING &amp; PLANNED</div></div>
            <div class="ax-tools"><button type="button" class="pl-add" id="plAddInline">+ ${L('เพิ่ม', 'Add')}</button></div></div>
          <div id="plItems"></div>
        </section>
      </div>
    </div>`;
    $('plMonths').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-k]');
      if (!b) return;
      selK = +b.dataset.k;
      render();
      b.scrollIntoView({ block: 'nearest', inline: 'center', behavior: Motion.reduced() ? 'auto' : 'smooth' });
    });
    $('plAddInline').addEventListener('click', () => openEditor());
    root.addEventListener('click', (e) => {
      const row = e.target.closest('[data-edit]');
      if (row) { const it = (state.plan || []).find((x) => String(x.id) === row.dataset.edit); if (it) openEditor(it); return; }
      const tpl = e.target.closest('[data-tpl]');
      if (tpl) openEditor(null, TEMPLATES()[+tpl.dataset.tpl]);
      const sug = e.target.closest('[data-suggest]');
      if (sug) openEditor(null, { type: 'expense', name: L('ค่ากิน', 'Food'), freq: 'daily', cat: 'food', amount: +sug.dataset.suggest });
    });
    if (window.Motion) Motion.reveal(root.querySelectorAll('.pl-card'));
  }

  /* ---------- แถบเลือกเดือน (บอกยอดคาดการณ์สิ้นเดือนด้วย) ---------- */
  function renderMonths(P, sums) {
    $('plMonths').innerHTML = sums.map((s) => `<button type="button" role="tab" data-k="${s.k}" class="pl-m ${s.k === selK ? 'active' : ''} ${s.status}" aria-selected="${s.k === selK}">
        <span class="mn">${months()[s.ms.getMonth()]}${s.ms.getMonth() === 0 || s.k === 0 ? ` <i>${String(yearOf(s.ms.getFullYear())).slice(-2)}</i>` : ''}</span>
        <span class="mv">${compact(s.endBal)}</span></button>`).join('');
  }

  /* ---------- การ์ดสรุป ---------- */
  function renderHero(S, P) {
    const st = STATUS[S.status];
    const cur = S.k === 0;
    let call;
    if (S.status === 'short') {
      call = L(`เงินจะติดลบตั้งแต่ <b>${dLabel(S.firstNeg)}</b> ขาดมากสุด <b>${fmtMoneyShort(-S.min)}</b> — ลองลดหรือเลื่อนบางรายการ หรือเพิ่มรายรับ`,
        `You'll go negative from <b>${dLabel(S.firstNeg)}</b>, short by up to <b>${fmtMoneyShort(-S.min)}</b> — trim or move some items, or add income`);
    } else {
      call = L(`ใช้นอกแผนได้อีกไม่เกิน <b>วันละ ${fmtMoneyShort(S.safe)}</b> โดยยอดไม่ติดลบ`, `You can spend up to <b>${fmtMoneyShort(S.safe)} a day</b> outside the plan without going negative`);
      if (S.status === 'tight') call = L('เหลือน้อย — ', 'Cutting it close — ') + call;
    }
    const hasDaily = P.plan.some((it) => it.type === 'expense' && it.freq === 'daily');
    const food = avgDailyFood();
    const suggest = !hasDaily && food > 0
      ? `<button type="button" class="pl-suggest" data-suggest="${food}"><span>${L(`ยังไม่มีค่ากินรายวันในแผน · 30 วันล่าสุดคุณใช้เฉลี่ยวันละ ${fmtMoneyShort(food)}`, `No daily food in the plan · you averaged ${fmtMoneyShort(food)}/day lately`)}</span><b>+ ${L('เพิ่ม', 'Add')}</b></button>`
      : '';
    $('plHero').innerHTML = `
      <div class="pl-hero-top"><span class="ax-label">FORECAST · ${monthTitle(S.ms).toUpperCase()}</span><span class="ax-chip ${st.chip}">${L(st.th, st.en)}</span></div>
      <div class="pl-big-label">${cur ? L('คาดว่าจะเหลือสิ้นเดือนนี้', 'Expected left at month end') : L(`คาดว่าจะเหลือสิ้นเดือน${months()[S.ms.getMonth()]}`, `Expected left at end of ${months()[S.ms.getMonth()]}`)}</div>
      <div class="pl-big ${S.endBal < 0 ? 'neg' : ''}" id="plBig">${money(S.endBal)}</div>
      <div class="pl-eq">
        <div><small>${cur ? L('ยอดตอนนี้', 'Balance now') : L('ยอดยกมา', 'Carried over')}</small><b>${money(S.start)}</b></div>
        <span class="op">+</span>
        <div><small>${L('รายรับตามแผน', 'Planned income')}</small><b class="pos">${fmtMoneyShort(S.inc)}</b></div>
        <span class="op">−</span>
        <div><small>${L('รายจ่ายตามแผน', 'Planned spend')}</small><b>${fmtMoneyShort(S.exp)}</b></div>
      </div>
      <p class="pl-call ${S.status}">${call}</p>
      ${cur ? `<p class="pl-foot">${L('นับรายการในแผนตั้งแต่พรุ่งนี้ รายการที่ถึงกำหนดแล้วถือว่าบันทึกเป็นรายการจริงไปแล้ว', 'Counts plan items from tomorrow — anything due earlier is assumed already recorded')}</p>` : ''}
      ${suggest}`;
  }

  /* ---------- กราฟยอดเงินตลอดเดือน ---------- */
  function renderChart(S, P) {
    const el = $('plChart');
    const W = Math.max(300, Math.round(el.clientWidth) || 560), H = W < 520 ? 210 : 240;
    const padL = 48, padR = 16, padT = 18, padB = 26, plotW = W - padL - padR, plotH = H - padT - padB;
    const dim = new Date(S.ms.getFullYear(), S.ms.getMonth() + 1, 0).getDate();
    const cur = S.k === 0, todayN = P.today.getDate();
    // เดือนนี้: ยอดจริงของวันที่ผ่านมา + ยอดคาดการณ์จากพรุ่งนี้
    const actual = [];
    if (cur) {
      let b = state.openingBalance;
      const endOf = [];
      const tx = state.txs.filter((x) => x.date < addDays(P.today, 1)).sort((a, c) => a.date - c.date);
      let i = 0;
      for (let d = 1; d <= todayN; d++) {
        const cut = new Date(S.ms.getFullYear(), S.ms.getMonth(), d + 1);
        while (i < tx.length && tx[i].date < cut) { b += tx[i].type === 'income' ? tx[i].amount : -tx[i].amount; i++; }
        endOf.push([d, b]);
      }
      actual.push(...endOf);
    }
    const proj = (cur ? [[todayN, S.start]] : [[0, S.start]]).concat(S.ds.map((x) => [x.d.getDate(), x.bal]));
    const all = actual.concat(proj).map((p) => p[1]);
    const lo = Math.min(0, ...all), hi = Math.max(0, ...all);
    const step = niceStep((hi - lo) / 4 || 250);
    const top = Math.max(step, Math.ceil(hi / step) * step), bottom = Math.floor(lo / step) * step;
    const X = (d) => padL + (d / dim) * plotW, Y = (v) => padT + ((top - v) / (top - bottom)) * plotH;
    const g = 'pl' + ++uid, y0 = Y(0);
    const path = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ');
    let svg = `<defs>
      <linearGradient id="${g}a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--accent);stop-opacity:0.3"/><stop offset="1" style="stop-color:var(--accent);stop-opacity:0"/></linearGradient>
      <clipPath id="${g}p"><rect x="0" y="-50" width="${W}" height="${(y0 + 50).toFixed(1)}"/></clipPath>
      <clipPath id="${g}n"><rect x="0" y="${y0.toFixed(1)}" width="${W}" height="${(H - y0 + 50).toFixed(1)}"/></clipPath></defs>`;
    for (let v = bottom; v <= top + 1e-9; v += step) {
      const yy = Y(v).toFixed(1);
      svg += `<line class="ax-gridline${Math.abs(v) < 1e-9 ? ' zero' : ''}" x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}"/><text class="ax-axis" x="${padL - 8}" y="${(+yy + 3.5).toFixed(1)}" text-anchor="end">${fmtAxis(v)}</text>`;
    }
    [1, 8, 15, 22, dim].forEach((d) => { svg += `<text class="ax-axis" x="${X(d).toFixed(1)}" y="${H - 8}" text-anchor="${d === dim ? 'end' : 'middle'}">${d}</text>`; });
    if (actual.length > 1) svg += `<path class="pl-actual" d="${path(actual)}"/>`;
    const pp = path(proj), last = proj[proj.length - 1], first = proj[0];
    const area = `${pp} L${X(last[0]).toFixed(1)},${y0.toFixed(1)} L${X(first[0]).toFixed(1)},${y0.toFixed(1)} Z`;
    svg += `<g class="ax-series">
      <path d="${area}" style="fill:url(#${g}a)" clip-path="url(#${g}p)"/>
      <path d="${area}" class="pl-neg-area" clip-path="url(#${g}n)"/>
      <path class="pl-proj" d="${pp}" clip-path="url(#${g}p)"/>
      <path class="pl-proj neg" d="${pp}" clip-path="url(#${g}n)"/></g>`;
    // จุดรายการก้อนใหญ่ (ไม่รวมรายวัน/รายสัปดาห์)
    const big = new Set(S.dated.map((e) => e.d.getDate()));
    S.ds.forEach((x) => { if (big.has(x.d.getDate())) svg += `<circle class="pl-ev ${x.bal < 0 ? 'neg' : ''}" cx="${X(x.d.getDate()).toFixed(1)}" cy="${Y(x.bal).toFixed(1)}" r="3.4"/>`; });
    if (cur) svg += `<line class="ax-today" x1="${X(todayN).toFixed(1)}" x2="${X(todayN).toFixed(1)}" y1="${padT}" y2="${padT + plotH}"/><text class="ax-axis ax-today-t" x="${X(todayN).toFixed(1)}" y="${padT - 5}" text-anchor="middle">${L('วันนี้', 'TODAY')}</text>`;
    svg += `<g class="ax-cross"><line id="${g}x" x1="0" x2="0" y1="${padT}" y2="${padT + plotH}"/><circle id="${g}c" r="5" style="stroke:var(--accent)"/></g>`;
    el.classList.remove('ready', 'hover');
    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${L('กราฟยอดเงินคาดการณ์', 'Projected balance chart')}">${svg}</svg><div class="ax-tip"></div>`;
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('ready')));
    $('plChartMonth').textContent = monthTitle(S.ms).toUpperCase();
    $('plLegend').innerHTML = (cur ? `<span><i class="solid soft"></i>${L('ยอดจริง', 'Actual')}</span>` : '')
      + `<span><i style="background:var(--accent)"></i>${L('คาดการณ์', 'Projected')}</span><span><i class="dot"></i>${L('วันที่มีรายการก้อนใหญ่', 'Scheduled item')}</span>`
      + `<b class="${S.min < 0 ? 'neg' : ''}">MIN ${money(S.min)}</b>`;

    // เส้นเล็ง + รายละเอียดของวัน
    const svgEl = el.querySelector('svg'), tip = el.querySelector('.ax-tip');
    const pts = (cur ? actual : []).concat(S.ds.map((x) => [x.d.getDate(), x.bal, x]));
    if (!pts.length) return;
    const show = (clientX) => {
      const rect = svgEl.getBoundingClientRect(), k = rect.width / W;
      const day = Math.round(((clientX - rect.left) / k - padL) / plotW * dim);
      let p = pts[0];
      pts.forEach((q) => { if (Math.abs(q[0] - day) < Math.abs(p[0] - day)) p = q; });
      const x = X(p[0]);
      $(g + 'x').setAttribute('x1', x); $(g + 'x').setAttribute('x2', x);
      $(g + 'c').setAttribute('cx', x); $(g + 'c').setAttribute('cy', Y(p[1]));
      const d = new Date(S.ms.getFullYear(), S.ms.getMonth(), p[0]);
      const ev = p[2] ? p[2].ev : [];
      const rows = ev.slice(0, 5).map((e) => `<div class="r"><span>${esc(e.it ? e.it.name : e.tx.title || '')}</span><b class="${e.type === 'income' ? 'pos' : ''}">${e.type === 'income' ? '+' : '−'}${fmtMoneyShort(e.amount)}</b></div>`).join('')
        + (ev.length > 5 ? `<div class="r n"><span>+${ev.length - 5} ${L('รายการ', 'more')}</span></div>` : '');
      tip.innerHTML = `<div class="h">${dLabel(d)}${p[2] ? '' : ' · ' + L('ยอดจริง', 'ACTUAL')}</div>${rows}<div class="r net"><span>${L('ยอดคงเหลือ', 'BALANCE')}</span><b class="${p[1] < 0 ? 'neg' : ''}">${money(p[1])}</b></div>`;
      const half = tip.offsetWidth / 2 + 6;
      tip.style.left = Math.max(half, Math.min(rect.width - half, x * k)) + 'px';
      el.classList.add('hover');
    };
    el.onpointermove = (e) => show(e.clientX);
    el.onpointerdown = (e) => show(e.clientX);
    el.onpointerleave = () => el.classList.remove('hover');
  }

  /* ---------- รายการของเดือน ---------- */
  function renderSchedule(S) {
    $('plListTitle').textContent = L(`รายการเดือน${months()[S.ms.getMonth()]}`, `${months()[S.ms.getMonth()]} schedule`);
    $('plListNote').textContent = S.k === 0 ? L('ตั้งแต่พรุ่งนี้', 'from tomorrow') : '';
    const box = $('plSchedule');
    if (!S.dated.length && !S.repeat.length) {
      box.innerHTML = `<div class="pl-empty">${L('ยังไม่มีรายการในแผนของเดือนนี้', 'Nothing planned for this month yet')}</div>`;
      return;
    }
    const sign = (e) => (e.type === 'income' ? '+' : '−');
    const row = (d, name, meta, amt, type, icon, tone, edit) => `<div class="pl-row" ${edit ? `data-edit="${edit}"` : ''} style="--c:${tone}">
        <span class="pl-date">${d || ''}</span><span class="ico sm">${icon}</span>
        <span class="pl-info"><span class="n">${name}</span><span class="m">${meta}</span></span>
        <span class="pl-amt ${type === 'income' ? 'pos' : ''}">${amt}</span></div>`;
    const dated = S.dated.slice().sort((a, b) => a.d - b.d).map((e) => {
      const d = `<b>${String(e.d.getDate()).padStart(2, '0')}</b>${WD_SHORT()[e.d.getDay()]}`;
      if (e.it) return row(d, esc(e.it.name), ruleText(e.it), `${sign(e)}${fmtMoneyShort(e.amount)}`, e.type, itemIcon(e.it), itemTone(e.it), e.it.id);
      return row(d, esc(e.tx.title || catName(e.tx.cat)), L('บันทึกไว้ล่วงหน้า', 'Recorded ahead'), `${sign(e)}${fmtMoneyShort(e.amount)}`, e.type, catIcon(e.tx.cat), catColorOf(e.tx.cat), null);
    }).join('');
    const rep = S.repeat.sort((a, b) => b.total - a.total).map((r) =>
      row('', esc(r.it.name), `${fmtMoneyShort(r.it.amount)} × ${r.n} ${r.it.freq === 'daily' ? L('วัน', 'days') : L('ครั้ง', 'times')} · ${ruleText(r.it)}`,
        `${r.it.type === 'income' ? '+' : '−'}${fmtMoneyShort(r.total)}`, r.it.type, itemIcon(r.it), itemTone(r.it), r.it.id)).join('');
    box.innerHTML = `<div class="pl-sum"><span>${L('รายรับ', 'In')} <b class="pos">${fmtMoneyShort(S.inc)}</b></span><span>${L('รายจ่าย', 'Out')} <b>${fmtMoneyShort(S.exp)}</b></span><span>${L('สุทธิ', 'Net')} <b class="${S.inc - S.exp < 0 ? 'neg' : 'pos'}">${S.inc - S.exp >= 0 ? '+' : ''}${money(S.inc - S.exp)}</b></span></div>`
      + (dated ? `<div class="pl-group">${L('ตามวันที่', 'By date')}</div>${dated}` : '')
      + (rep ? `<div class="pl-group">${L('รายวัน / รายสัปดาห์', 'Daily / weekly')}</div>${rep}` : '');
  }

  /* ---------- แผนทั้งหมด ---------- */
  const TEMPLATES = () => [
    { type: 'expense', name: L('ค่าหอ', 'Rent'), freq: 'monthly', day: 1, cat: null },
    { type: 'expense', name: L('ค่าเน็ต', 'Internet'), freq: 'monthly', day: 5, cat: null },
    { type: 'expense', name: L('ค่าโทรศัพท์', 'Phone'), freq: 'monthly', day: 5, cat: null },
    { type: 'expense', name: L('ค่ากิน', 'Food'), freq: 'daily', cat: 'food' },
    { type: 'expense', name: L('ค่าเดินทาง', 'Transport'), freq: 'daily', cat: 'travel' },
    { type: 'income', name: L('เงินจากบ้าน', 'Allowance'), freq: 'monthly', day: 1, cat: 'allowance' },
    { type: 'income', name: L('ค่าจ้างงานพิเศษ', 'Part-time pay'), freq: 'weekly', day: 6, cat: 'parttime' },
    { type: 'expense', name: L('ค่าเทอม', 'Tuition'), freq: 'once', cat: null }
  ];
  function renderItems(P) {
    const box = $('plItems');
    const tpl = `<div class="pl-tpls">${TEMPLATES().map((x, i) => `<button type="button" data-tpl="${i}">${x.type === 'income' ? '+ ' : ''}${esc(x.name)}</button>`).join('')}</div>`;
    if (!P.plan.length) {
      box.innerHTML = `<div class="pl-empty"><b>${L('เริ่มวางแผนจากรายการที่จ่ายประจำ', 'Start with what you pay regularly')}</b>${L('เช่น ค่าหอ ค่าเน็ต ค่ากินรายวัน และรายรับอย่างเงินจากบ้าน แล้วระบบจะบอกว่าแต่ละเดือนเงินพอไหม', 'Rent, internet, daily food, plus income like an allowance — we\'ll tell you if each month works out')}</div>${tpl}`;
      return;
    }
    const group = (type) => {
      const list = P.plan.filter((it) => it.type === type).sort((a, b) => perMonth(b) - perMonth(a) || b.amount - a.amount);
      if (!list.length) return '';
      const total = list.reduce((s, it) => s + perMonth(it), 0);
      return `<div class="pl-group">${type === 'income' ? L('รายรับ', 'Income') : L('รายจ่าย', 'Expenses')}<span>≈ ${fmtMoneyShort(total)}${L('/เดือน', '/mo')}</span></div>`
        + list.map((it) => `<div class="pl-row" data-edit="${it.id}" style="--c:${itemTone(it)}" role="button" tabindex="0">
            <span class="ico sm">${itemIcon(it)}</span>
            <span class="pl-info"><span class="n">${esc(it.name)}</span><span class="m">${ruleText(it)}${it.freq === 'daily' || it.freq === 'weekly' ? ` · ≈ ${fmtMoneyShort(perMonth(it))}${L('/เดือน', '/mo')}` : ''}</span></span>
            <span class="pl-amt ${type === 'income' ? 'pos' : ''}">${type === 'income' ? '+' : ''}${fmtMoneyShort(it.amount)}</span>
            <svg class="chev" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></div>`).join('');
    };
    const inc = P.plan.filter((it) => it.type === 'income').reduce((s, it) => s + perMonth(it), 0);
    const exp = P.plan.filter((it) => it.type === 'expense').reduce((s, it) => s + perMonth(it), 0);
    box.innerHTML = group('expense') + group('income')
      + `<div class="pl-net"><span>${L('รายรับประจำ − รายจ่ายประจำ', 'Recurring in − out')}</span><b class="${inc - exp < 0 ? 'neg' : 'pos'}">${inc - exp >= 0 ? '+' : ''}${money(inc - exp)}${L('/เดือน', '/mo')}</b></div>`
      + `<div class="pl-tpl-label">${L('เพิ่มเร็ว', 'Quick add')}</div>${tpl}`;
  }

  /* ---------- หน้าต่างเพิ่ม/แก้ไข ---------- */
  const ed = { id: null, type: 'expense', freq: 'monthly', day: 1, wday: 1, date: '', cat: null, saving: false };
  function openEditor(it, preset) {
    const src = it || preset || {};
    ed.id = it ? it.id : null;
    ed.type = src.type || 'expense';
    ed.freq = src.freq || 'monthly';
    ed.day = src.freq === 'monthly' && src.day ? +src.day : Math.min(28, new Date().getDate());
    ed.wday = src.freq === 'weekly' && src.day !== undefined && src.day !== null ? +src.day : 6;
    const nextMonth = new Date(); nextMonth.setMonth(nextMonth.getMonth() + 1, 1);
    ed.date = src.on_date || isoDate(nextMonth);
    ed.cat = src.cat || null;
    $('plModalTitle').textContent = it ? L('แก้ไขรายการในแผน', 'Edit plan item') : L('เพิ่มรายการในแผน', 'Add to plan');
    $('plName').value = src.name || '';
    $('plAmount').value = src.amount ? +src.amount : '';
    $('plErr').style.display = 'none';
    $('plDelete').hidden = !it;
    $('plSave').disabled = false;
    paintEditor();
    $('planOverlay').classList.add('open');
    setTimeout(() => (src.name ? $('plAmount') : $('plName')).focus(), 250);
  }
  function closeEditor() { $('planOverlay').classList.remove('open'); }
  function paintEditor() {
    document.querySelectorAll('#plType button').forEach((b) => b.classList.toggle('active', b.dataset.t === ed.type));
    document.querySelectorAll('#plFreq button').forEach((b) => b.classList.toggle('active', b.dataset.f === ed.freq));
    const f = $('plWhen');
    if (ed.freq === 'daily') f.innerHTML = `<p class="pl-hint">${L('นับทุกวัน เช่น ค่ากิน ค่าเดินทาง', 'Counted every day — e.g. food, transport')}</p>`;
    else if (ed.freq === 'weekly') {
      f.innerHTML = `<label>${L('ทุกวัน', 'Every')}</label><div class="pl-wd">${WD_SHORT().map((w, i) => `<button type="button" data-wd="${i}" class="${i === ed.wday ? 'active' : ''}">${w}</button>`).join('')}</div>`;
    } else if (ed.freq === 'monthly') {
      f.innerHTML = `<label>${L('วันที่ของเดือน', 'Day of month')}</label><input type="number" id="plDay" min="1" max="31" step="1" value="${ed.day}"><p class="pl-hint">${L('ถ้าเดือนนั้นไม่มีวันที่นี้ จะนับเป็นวันสุดท้ายของเดือน', 'Falls on the last day in shorter months')}</p>`;
      $('plDay').addEventListener('input', (e) => { ed.day = Math.max(1, Math.min(31, parseInt(e.target.value, 10) || 1)); });
    } else {
      f.innerHTML = `<label>${L('วันที่', 'Date')}</label><input type="date" id="plDate" value="${ed.date}">`;
      $('plDate').addEventListener('input', (e) => { ed.date = e.target.value; });
    }
  }
  async function saveEditor() {
    if (ed.saving) return;
    const name = $('plName').value.trim(), amount = parseFloat($('plAmount').value);
    const err = (msg) => { $('plErr').textContent = msg; $('plErr').style.display = 'block'; };
    if (!name) return err(L('กรุณาใส่ชื่อรายการ', 'Please enter a name'));
    if (!(amount > 0)) return err(L('กรุณาระบุจำนวนเงินให้ถูกต้อง', 'Please enter a valid amount'));
    if (ed.freq === 'once' && !parseDate(ed.date)) return err(L('กรุณาเลือกวันที่', 'Please pick a date'));
    const body = { type: ed.type, name, amount, freq: ed.freq, cat: ed.cat,
      day: ed.freq === 'monthly' ? ed.day : ed.freq === 'weekly' ? ed.wday : null,
      onDate: ed.freq === 'once' ? ed.date : null };
    ed.saving = true; $('plSave').disabled = true;
    try {
      const res = await fetch(ed.id ? '/api/plan/' + ed.id : '/api/plan', { method: ed.id ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { err(data.error || t('toast_error')); return; }
      state.plan = ed.id ? state.plan.map((x) => (x.id === ed.id ? data.item : x)) : state.plan.concat(data.item);
      closeEditor();
      showToast(ed.id ? L('แก้ไขแผนแล้ว', 'Plan updated') : L('เพิ่มในแผนแล้ว', 'Added to plan'), false);
      render(); homeTile();
    } catch (e) {
      console.error(e); err(t('toast_error'));
    } finally { ed.saving = false; $('plSave').disabled = false; }
  }
  async function deleteItem() {
    if (!ed.id || ed.saving) return;
    ed.saving = true;
    try {
      const res = await fetch('/api/plan/' + ed.id, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json().catch(() => ({})); showToast(d.error || t('toast_error'), true); return; }
      state.plan = state.plan.filter((x) => x.id !== ed.id);
      closeEditor();
      showToast(L('ลบออกจากแผนแล้ว', 'Removed from plan'), false);
      render(); homeTile();
    } catch (e) { console.error(e); showToast(t('toast_error'), true); } finally { ed.saving = false; }
  }
  function initEditor() {
    $('plType').addEventListener('click', (e) => { const b = e.target.closest('button[data-t]'); if (b) { ed.type = b.dataset.t; paintEditor(); } });
    $('plFreq').addEventListener('click', (e) => { const b = e.target.closest('button[data-f]'); if (b) { ed.freq = b.dataset.f; paintEditor(); } });
    $('plWhen').addEventListener('click', (e) => { const b = e.target.closest('button[data-wd]'); if (b) { ed.wday = +b.dataset.wd; paintEditor(); } });
    $('plSave').addEventListener('click', saveEditor);
    $('plCancel').addEventListener('click', closeEditor);
    $('plDelete').addEventListener('click', deleteItem);
    $('planOverlay').addEventListener('click', (e) => { if (e.target.id === 'planOverlay') closeEditor(); });
    ['plName', 'plAmount'].forEach((id) => $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') saveEditor(); }));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('planOverlay').classList.contains('open')) closeEditor(); });
    $('planAddBtn').addEventListener('click', () => openEditor());
  }

  /* ---------- การ์ดย่อในหน้าหลัก ---------- */
  function homeTile() {
    const v = $('homePlanVal'), txt = $('homePlanText');
    if (!v || !state.user) return;
    if (!(state.plan || []).length) {
      v.textContent = L('เริ่มวางแผน', 'Set up');
      v.className = 'v plan-v empty';
      txt.textContent = L('ดูว่าเดือนนี้เงินพอไหม', 'See if this month works out');
      return;
    }
    const P = project();
    const S = monthSummary(P, 0);
    tweenNumber(v, S.endBal, money);
    v.className = 'v plan-v ' + S.status;
    txt.textContent = `${L('คาดว่าเหลือสิ้นเดือน', 'Left at month end')} · ${L(STATUS[S.status].th, STATUS[S.status].en)}`;
    // เดือนนี้ยังไหว แต่อีก 1-2 เดือนข้างหน้าเงินจะไม่พอ — เตือนไว้ก่อน
    if (S.status !== 'short') {
      const ahead = [1, 2].map((k) => monthSummary(P, k)).find((x) => x.status === 'short');
      if (ahead) {
        txt.textContent = L(`ระวัง: เดือน${months()[ahead.ms.getMonth()]}เงินจะไม่พอ`, `Heads up: ${months()[ahead.ms.getMonth()]} runs short`);
        v.className = 'v plan-v tight';
      }
    }
  }

  /* ---------- entry ---------- */
  function render() {
    const root = $('planRoot');
    if (!root || !state.user || !$('view-plan').classList.contains('active')) return;
    if (builtLang !== lang) { build(root); builtLang = lang; }
    const P = project();
    const sums = Array.from({ length: HORIZON }, (_, k) => monthSummary(P, k));
    if (selK >= HORIZON) selK = 0;
    const S = sums[selK];
    renderMonths(P, sums);
    renderHero(S, P);
    renderChart(S, P);
    renderSchedule(S);
    renderItems(P);
  }

  window.Planner = { render, homeTile, initEditor, openEditor, ruleText };
})();
