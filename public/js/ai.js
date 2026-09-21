/* ai.js — ผู้ช่วย AI ฝั่งหน้าเว็บ
   1) สรุปและคำแนะนำประจำเดือน (หน้า Analytics)   2) แชทถาม AI (ปุ่มบนแถบด้านบน)
   3) ผู้ช่วยวางแผน (หน้าวางแผน)                    4) คำแนะนำเมื่อใช้เงินใกล้ถึง/เกินงบ (หน้าหลัก)
   ทุกอย่างซ่อนอยู่ถ้าเซิร์ฟเวอร์ไม่ได้ตั้ง GEMINI_API_KEY และต้องให้ผู้ใช้กดยินยอมก่อนส่งข้อมูลให้ AI
   ใช้ของจากสคริปต์หลักใน app.html: state, lang, escapeHtml, fmtMoneyShort, getBudgetForMonth, sameMonth,
   showToast, goView, Planner */
(function () {
  const L = (th, en) => (lang === 'th' ? th : en);
  const $ = (id) => document.getElementById(id);
  const esc = (s) => escapeHtml(String(s == null ? '' : s));
  const AI = {
    enabled: false, consent: false, paid: false, used: 0, limit: 30,
    insights: null, insightsChecked: false, insightsBusy: false, insightsErr: null,
    advice: null, adviceChecked: null, adviceBusy: false, adviceErr: null,
    chat: [], chatBusy: false, plan: null, planBusy: false, planErr: null, added: new Set()
  };
  const MARK = '<span class="ai-mark" aria-hidden="true">AI</span>';
  const ICON_CHAT = '<svg viewBox="0 0 24 24"><path d="M5 18.5V6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v7a2.5 2.5 0 0 1-2.5 2.5H9z"/><path d="M9 9h6M9 12h4"/></svg>';
  const ICON_SEND = '<svg viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6"/></svg>';
  const ICON_X = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';

  /* ---------- เรียก API ---------- */
  async function api(url, body) {
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, lang, tzOffset: new Date().getTimezoneOffset() })
    });
    const data = await res.json().catch(() => ({}));
    if (typeof data.used === 'number') { AI.used = data.used; renderProfile(); }
    if (!res.ok) {
      const err = new Error(data.error || 'error');
      err.code = data.code;
      if (data.code === 'consent') { AI.consent = false; renderAll(); }
      throw err;
    }
    return data;
  }
  function errText(e) {
    return {
      limit: L(`วันนี้ใช้ AI ครบ ${AI.limit} ครั้งแล้ว พรุ่งนี้ใช้ได้ใหม่`, `You've used all ${AI.limit} AI requests for today`),
      quota: L('ระบบ AI มีคนใช้เยอะ ลองใหม่อีกสักครู่', 'The AI service is busy — try again shortly'),
      timeout: L('AI ตอบช้าเกินไป ลองใหม่อีกครั้ง', 'AI took too long — try again'),
      blocked: L('AI ตอบคำถามนี้ไม่ได้ ลองถามแบบอื่น', "AI couldn't answer that — try rephrasing"),
      input: e.message,
      disabled: L('ยังไม่ได้เปิดใช้ AI', 'AI is not enabled')
    }[e.code] || L('AI ตอบกลับไม่สำเร็จ ลองใหม่อีกครั้ง', 'The AI request failed — try again');
  }
  const remaining = () => Math.max(0, AI.limit - AI.used);
  const quotaText = () => L(`เหลือ ${remaining()}/${AI.limit} ครั้งวันนี้`, `${remaining()}/${AI.limit} left today`);
  const disclaimer = () => L('คำแนะนำทั่วไปจาก AI อาจคลาดเคลื่อน ไม่ใช่คำแนะนำทางการเงินจากผู้เชี่ยวชาญ', 'General guidance from AI — may be inaccurate and is not professional financial advice');
  // เวลาที่ AI สร้างผล: วันนี้แสดงแค่เวลา วันอื่นแสดงวันที่ด้วย
  const whenOf = (iso) => {
    const d = new Date(iso), loc = lang === 'th' ? 'th-TH' : 'en-US';
    const time = d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' });
    return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString(loc, { day: 'numeric', month: 'short' })} ${time}`;
  };

  // ข้อความจาก AI → HTML ที่ปลอดภัย (escape ก่อน แล้วค่อยแปลง **ตัวหนา** และรายการ "- ")
  function rich(text) {
    const out = [];
    let list = null;
    esc(text).split(/\n+/).forEach((line) => {
      const t = line.trim();
      if (!t) return;
      const html = t.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
      if (/^([-•*]|\d+[.)])\s+/.test(t)) {
        if (!list) { list = []; out.push(list); }
        list.push(html.replace(/^([-•*]|\d+[.)])\s+/, ''));
      } else { list = null; out.push(`<p>${html}</p>`); }
    });
    return out.map((x) => (Array.isArray(x) ? `<ul>${x.map((li) => `<li>${li}</li>`).join('')}</ul>` : x)).join('');
  }

  /* ---------- ความยินยอม ---------- */
  function consentBlock(compact) {
    const free = !AI.paid;
    return `<div class="ai-consent ${compact ? 'compact' : ''}">
      <p>${L('ผู้ช่วย AI จะอ่าน<b>ตัวเลขสรุป</b>ของคุณ เช่น ยอดตามหมวด งบ และรายการในแผน รวมถึงข้อความที่คุณพิมพ์ถาม แล้วส่งไปประมวลผลที่ Google Gemini — ไม่ส่งชื่อผู้ใช้ อีเมล หรือรายละเอียดของแต่ละรายการ',
        'The AI assistant reads your <b>summary numbers</b> — category totals, budget and plan items — plus anything you type, and sends them to Google Gemini. Your username, email and individual transactions are not sent.')}</p>
      ${free ? `<p class="fine">${L('ระบบใช้ Gemini แพลนฟรี ซึ่ง Google อาจนำข้อมูลที่ส่งไปใช้ปรับปรุงบริการได้', 'This uses the Gemini free tier, where Google may use submitted data to improve its services.')}</p>` : ''}
      <p class="fine">${L('ปิดได้ทุกเมื่อที่หน้าโปรไฟล์', 'You can turn it off anytime in Profile')} · <a href="privacy.html#ai" target="_blank" rel="noopener">${L('อ่านรายละเอียด', 'Details')}</a></p>
      <button type="button" class="btn btn-primary ai-consent-btn" data-ai-consent="1">${L('ยินยอมและเปิดใช้ AI', 'Agree & turn on AI')}</button>
    </div>`;
  }
  async function setConsent(on) {
    try {
      const res = await fetch('/api/ai/consent', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on }) });
      if (!res.ok) throw new Error('consent');
      AI.consent = on;
      if (!on) { AI.insights = null; AI.insightsChecked = false; AI.insightsErr = null; AI.advice = null; AI.adviceChecked = null; AI.adviceErr = null; AI.chat = []; AI.plan = null; }
      showToast(on ? L('เปิดใช้ผู้ช่วย AI แล้ว', 'AI assistant turned on') : L('ปิดผู้ช่วย AI แล้ว', 'AI assistant turned off'), false);
      renderAll();
      if (on) { if (insightsVisible()) loadSavedInsights(); loadSavedAdvice(); }
    } catch (e) { showToast(L('บันทึกไม่สำเร็จ', 'Could not save'), true); }
  }
  document.addEventListener('click', (e) => { if (e.target.closest('[data-ai-consent]')) setConsent(true); });

  /* ---------- 1) สรุปและคำแนะนำ (Analytics) ----------
     AI จะวิเคราะห์ใหม่เฉพาะตอนผู้ใช้กดปุ่มเท่านั้น — เปิดหน้า/สลับหน้า/เปลี่ยนภาษา แค่ดึงผลล่าสุดที่เก็บไว้ (ไม่เสียโควตา) */
  function insightsVisible() {
    const slot = $('aiInsightsSlot');
    return slot && !slot.hidden && $('view-reports').classList.contains('active');
  }
  async function loadSavedInsights() {
    if (!AI.enabled || !AI.consent || AI.insightsChecked || AI.insightsBusy) return;
    AI.insightsChecked = true;
    AI.insightsBusy = 'peek'; renderInsights();
    try { const d = await api('/api/ai/insights', {}); if (!d.none) AI.insights = d; } catch (e) { /* ไม่มีผลเดิมก็แค่แสดงปุ่ม */ }
    AI.insightsBusy = false; renderInsights();
  }
  async function generateInsights() {
    if (!AI.enabled || !AI.consent || AI.insightsBusy) return;
    AI.insightsBusy = 'gen'; AI.insightsErr = null; renderInsights();
    try { AI.insights = await api('/api/ai/insights', { generate: true }); } catch (e) { AI.insightsErr = e.code === 'consent' ? null : errText(e); }
    AI.insightsBusy = false; renderInsights();
  }
  function renderInsights() {
    const slot = $('aiInsightsSlot');
    if (!slot) return;
    if (!AI.enabled) { slot.innerHTML = ''; return; }
    const I = AI.insights;
    const head = `<div class="ai-head">${MARK}<div class="ai-ht"><h3>${L('สรุปและคำแนะนำจาก AI', 'AI summary & advice')}</h3><div class="ax-en">AI INSIGHTS${I && I.generatedAt ? ' · ' + L('วิเคราะห์เมื่อ ', 'ANALYSED ') + whenOf(I.generatedAt) : ''}</div></div>
      ${AI.consent && I && !AI.insightsBusy ? `<button type="button" class="ai-ghost" id="aiGen" title="${L('ใช้โควตา 1 ครั้ง', 'Uses 1 request')}">${L('วิเคราะห์ใหม่', 'Analyse again')}</button>` : ''}</div>`;
    let body;
    if (!AI.consent) body = consentBlock(false);
    else if (AI.insightsBusy === 'gen') body = `<div class="ai-skel"><i style="width:62%"></i><i></i><i style="width:88%"></i><i style="width:74%"></i></div><p class="ai-wait">${L('AI กำลังอ่านข้อมูลของคุณ…', 'AI is reading your numbers…')}</p>`;
    else if (AI.insightsBusy === 'peek' && !I) body = '<div class="ai-skel"><i style="width:48%"></i></div>';
    else if (AI.insightsErr && !I) body = `<p class="ai-err">${esc(AI.insightsErr)}</p><button type="button" class="ai-ghost" id="aiGen">${L('ลองอีกครั้ง', 'Try again')}</button>`;
    else if (I) {
      const tag = { good: ['GOOD', 'good'], warn: ['WATCH', 'warn'], tip: ['TIP', 'tip'] };
      body = `${AI.insightsErr ? `<p class="ai-err">${esc(AI.insightsErr)}</p>` : ''}
        ${I.headline ? `<p class="ai-headline">${esc(I.headline)}</p>` : ''}
        ${I.summary ? `<p class="ai-summary">${esc(I.summary)}</p>` : ''}
        <div class="ai-points">${I.points.map((p) => `<div class="ai-point"><span class="ai-tag ${tag[p.tone][1]}">${tag[p.tone][0]}</span><div><b>${esc(p.title)}</b><p>${esc(p.detail)}</p></div></div>`).join('')}</div>
        ${I.lang && I.lang !== lang ? `<p class="ai-note">${L('ผลนี้วิเคราะห์เป็นภาษาอังกฤษ — กด "วิเคราะห์ใหม่" ถ้าต้องการภาษาไทย', 'This was generated in Thai — press "Analyse again" for English')}</p>` : ''}
        <p class="ai-foot">${disclaimer()} · ${quotaText()}</p>`;
    } else {
      body = `<p class="ai-summary">${L('ให้ AI อ่านตัวเลขของคุณแล้วสรุปสิ่งที่ทำได้ดี สิ่งที่ควรระวัง และคำแนะนำที่ทำได้จริง', 'Let AI read your numbers and summarise what is going well, what to watch, and practical tips.')}</p>
        <div class="ai-cta"><button type="button" class="btn btn-primary" id="aiGen">${L('ให้ AI วิเคราะห์', 'Analyse with AI')}</button><span>${L('ใช้ 1 ครั้ง', 'Uses 1 request')} · ${quotaText()}</span></div>`;
    }
    slot.innerHTML = `<section class="glass ai-card">${head}${body}</section>`;
    const g = $('aiGen'); if (g) g.onclick = generateInsights;
  }
  function showInsights() {
    renderInsights();
    if (insightsVisible()) loadSavedInsights();
  }

  /* ---------- 4) คำแนะนำเมื่อใช้เงินใกล้ถึง/เกินงบ (หน้าหลัก) — AI ตอบเมื่อผู้ใช้กดขอเท่านั้น ---------- */
  function budgetState() {
    const now = new Date();
    const budget = getBudgetForMonth(now.getFullYear(), now.getMonth());
    const spent = state.txs.filter((x) => x.type === 'expense' && sameMonth(x.date, now)).reduce((s, x) => s + x.amount, 0);
    const level = budget > 0 && spent > budget ? 'over' : budget > 0 && spent >= budget * 0.8 ? 'near' : 'ok';
    const dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const daysLeft = dim - now.getDate() + 1;
    return { level, budget, spent, pct: budget > 0 ? Math.round((spent / budget) * 100) : 0, perDay: Math.max(0, (budget - spent) / daysLeft), daysLeft, key: `${now.getFullYear()}-${now.getMonth()}|${level}` };
  }
  async function loadSavedAdvice() {
    const b = budgetState();
    if (!AI.enabled || !AI.consent || b.level === 'ok' || AI.adviceBusy || AI.adviceChecked === b.key) return;
    AI.adviceChecked = b.key;
    try { const d = await api('/api/ai/budget-advice', {}); AI.advice = d.none || d.level === 'ok' ? null : d; } catch (e) { /* แสดงปุ่มให้กดขอแทน */ }
    renderAdvice();
  }
  async function generateAdvice() {
    if (!AI.enabled || !AI.consent || AI.adviceBusy) return;
    AI.adviceBusy = true; AI.adviceErr = null; renderAdvice();
    try { AI.advice = await api('/api/ai/budget-advice', { generate: true }); } catch (e) { AI.adviceErr = e.code === 'consent' ? null : errText(e); }
    AI.adviceBusy = false; renderAdvice();
  }
  function renderAdvice() {
    const slot = $('aiBudgetSlot');
    if (!slot) return;
    const b = budgetState();
    if (!AI.enabled || b.level === 'ok') { slot.innerHTML = ''; return; }
    const over = b.level === 'over';
    const rule = over
      ? L(`เดือนนี้ใช้ไป ${fmtMoneyShort(b.spent)} เกินงบ ${fmtMoneyShort(b.spent - b.budget)} แล้ว`, `You've spent ${fmtMoneyShort(b.spent)} — ${fmtMoneyShort(b.spent - b.budget)} over budget`)
      : L(`ใช้ไป ${b.pct}% ของงบแล้ว เหลือใช้ได้อีกประมาณวันละ ${fmtMoneyShort(b.perDay)} (${b.daysLeft} วัน)`, `${b.pct}% of budget used — about ${fmtMoneyShort(b.perDay)}/day left for ${b.daysLeft} days`);
    const A = AI.advice && AI.advice.level === b.level && AI.advice.message ? AI.advice : null;
    let body;
    if (!AI.consent) body = `<p class="ai-summary">${rule}</p>${consentBlock(true)}`;
    else if (AI.adviceBusy) body = `<p class="ai-summary">${rule}</p><div class="ai-skel"><i style="width:80%"></i><i style="width:64%"></i></div>`;
    else if (A) {
      body = `<p class="ai-summary">${esc(A.message)}</p>${A.tips.length ? `<ul class="ai-tips">${A.tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
        ${AI.adviceErr ? `<p class="ai-err">${esc(AI.adviceErr)}</p>` : ''}
        <div class="ai-cta"><button type="button" class="ai-ghost" id="aiAdviceGen">${L('ขอคำแนะนำใหม่', 'New advice')}</button><span>${L('แนะนำเมื่อ ', 'Given ')}${whenOf(A.generatedAt)} · ${disclaimer()}</span></div>`;
    } else {
      body = `<p class="ai-summary">${rule}</p>${AI.adviceErr ? `<p class="ai-err">${esc(AI.adviceErr)}</p>` : ''}
        <div class="ai-cta"><button type="button" class="btn btn-primary" id="aiAdviceGen">${L('ขอคำแนะนำจาก AI', 'Get AI advice')}</button><span>${L('ใช้ 1 ครั้ง', 'Uses 1 request')} · ${quotaText()}</span></div>`;
    }
    slot.innerHTML = `<section class="glass ai-card ai-budget ${b.level}">
      <div class="ai-head">${MARK}<div class="ai-ht"><h3>${over ? L('ใช้เกินงบแล้ว', 'Over budget') : L('ใกล้ถึงงบแล้ว', 'Close to budget')}</h3><div class="ax-en">BUDGET ADVICE</div></div>
        <span class="ax-chip ${over ? 'down' : 'warn'}">${b.pct}%</span></div>
      <div class="ai-meter"><i style="width:${Math.min(100, b.pct)}%"></i></div>${body}</section>`;
    const g = $('aiAdviceGen'); if (g) g.onclick = generateAdvice;
  }

  /* ---------- 2) แชท ---------- */
  const SUGGEST = () => [
    L('เดือนนี้ฉันใช้เงินกับอะไรมากที่สุด', 'What did I spend the most on this month?'),
    L('จะเก็บเงินได้เดือนละเท่าไร', 'How much can I save each month?'),
    L('ช่วยลดค่ากินหน่อย', 'Help me cut food costs'),
    L('เดือนหน้าเงินจะพอใช้ไหม', 'Will my money last next month?')
  ];
  function buildChat() {
    if ($('aiChatOverlay')) return;
    const ov = document.createElement('div');
    ov.className = 'modal-overlay';
    ov.id = 'aiChatOverlay';
    ov.innerHTML = `<div class="modal ai-chat" role="dialog" aria-modal="true" aria-labelledby="aiChatTitle">
      <div class="ai-chat-head">${MARK}<div class="ai-ht"><h3 id="aiChatTitle"></h3><div class="ax-en" id="aiChatSub"></div></div><button type="button" class="ai-x" id="aiChatClose" aria-label="close">${ICON_X}</button></div>
      <div class="ai-chat-body" id="aiChatBody" aria-live="polite"></div>
      <div class="ai-chat-foot" id="aiChatFoot"></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener('click', (e) => { if (e.target === ov) closeChat(); });
    $('aiChatClose').onclick = closeChat;
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && ov.classList.contains('open')) closeChat(); });
  }
  function openChat() {
    buildChat();
    renderChat();
    $('aiChatOverlay').classList.add('open');
    setTimeout(() => { const i = $('aiInput'); if (i) i.focus(); }, 300);
  }
  function closeChat() { const ov = $('aiChatOverlay'); if (ov) ov.classList.remove('open'); }
  function renderChat() {
    if (!$('aiChatOverlay')) return;
    $('aiChatTitle').textContent = L('ถาม MoneyMate AI', 'Ask MoneyMate AI');
    $('aiChatSub').textContent = AI.consent ? `AI ASSISTANT · ${quotaText().toUpperCase()}` : 'AI ASSISTANT';
    const body = $('aiChatBody'), foot = $('aiChatFoot');
    if (!AI.consent) { body.innerHTML = consentBlock(false); foot.innerHTML = ''; return; }
    const msgs = AI.chat.map((m) => (m.role === 'user'
      ? `<div class="ai-msg me">${esc(m.text).replace(/\n/g, '<br>')}</div>`
      : `<div class="ai-msg bot ${m.error ? 'err' : ''}">${m.error ? esc(m.text) : rich(m.text)}</div>`)).join('');
    body.innerHTML = (AI.chat.length ? '' : `<div class="ai-hello"><p>${L('ถามเรื่องเงินของคุณได้เลย เช่น ใช้เงินกับอะไรเยอะ จะเก็บเงินยังไง หรือเดือนหน้าพอไหม', 'Ask anything about your money — where it goes, how to save, whether next month works out.')}</p>
        <div class="ai-chips">${SUGGEST().map((s) => `<button type="button" data-ask="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>`)
      + msgs + (AI.chatBusy ? '<div class="ai-msg bot typing"><i></i><i></i><i></i></div>' : '');
    body.querySelectorAll('[data-ask]').forEach((b) => (b.onclick = () => sendChat(b.dataset.ask)));
    body.scrollTop = body.scrollHeight;
    if (!foot.querySelector('#aiInput')) {
      foot.innerHTML = `<form class="ai-compose" id="aiForm"><textarea id="aiInput" rows="1" maxlength="1000"></textarea><button type="submit" class="ai-send" id="aiSend" aria-label="send">${ICON_SEND}</button></form><p class="ai-foot">${disclaimer()}</p>`;
      const input = $('aiInput');
      input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(120, input.scrollHeight) + 'px'; });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendChat(input.value); } });
      $('aiForm').addEventListener('submit', (e) => { e.preventDefault(); sendChat(input.value); });
    }
    $('aiInput').placeholder = L('พิมพ์คำถาม…', 'Type a question…');
    $('aiSend').disabled = AI.chatBusy;
  }
  async function sendChat(text) {
    text = String(text || '').trim();
    if (!text || AI.chatBusy) return;
    AI.chat.push({ role: 'user', text });
    AI.chatBusy = true;
    const input = $('aiInput'); if (input) { input.value = ''; input.style.height = 'auto'; }
    renderChat();
    try {
      const history = AI.chat.filter((m) => !m.error).slice(-12).map((m) => ({ role: m.role, text: m.text }));
      const data = await api('/api/ai/chat', { messages: history });
      AI.chat.push({ role: 'model', text: data.reply });
    } catch (e) {
      if (e.code !== 'consent') AI.chat.push({ role: 'model', text: errText(e), error: true });
    }
    AI.chatBusy = false;
    renderChat();
  }

  /* ---------- 3) ผู้ช่วยวางแผน ---------- */
  const PLAN_IDEAS = () => [
    L('อยากเก็บเงิน 5,000 บาทใน 3 เดือน', 'Save ฿5,000 in 3 months'),
    L('ช่วยตั้งเพดานค่ากินรายวันให้หน่อย', 'Set a sensible daily food cap'),
    L('เดือนหน้าเงินอาจไม่พอ ช่วยปรับแผน', 'Next month looks tight — adjust my plan')
  ];
  async function askPlan(goal) {
    goal = String(goal || '').trim();
    if (goal.length < 3 || AI.planBusy) return;
    AI.planBusy = true; AI.planErr = null; AI.plan = null; AI.added = new Set(); AI.planGoal = goal; renderPlan();
    try { AI.plan = await api('/api/ai/plan', { goal }); } catch (e) { AI.planErr = e.code === 'consent' ? null : errText(e); }
    AI.planBusy = false; renderPlan();
  }
  async function addSuggestion(i) {
    const it = AI.plan && AI.plan.items[i];
    if (!it || AI.added.has(i)) return false;
    try {
      const res = await fetch('/api/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(it) });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { showToast(data.error || L('เพิ่มไม่สำเร็จ', 'Could not add'), true); return false; }
      state.plan = state.plan.concat(data.item);
      AI.added.add(i);
      return true;
    } catch (e) { showToast(L('เพิ่มไม่สำเร็จ', 'Could not add'), true); return false; }
  }
  function renderPlan() {
    const slot = $('aiPlanSlot');
    if (!slot) return;
    if (!AI.enabled) { slot.innerHTML = ''; return; }
    let body;
    if (!AI.consent) body = consentBlock(false);
    else {
      const form = `<form class="ai-goal" id="aiGoalForm"><textarea id="aiGoal" rows="2" maxlength="300" placeholder="${L('เช่น อยากเก็บเงินซื้อโน้ตบุ๊ก 25,000 ภายในมีนาคม', 'e.g. Save ฿25,000 for a laptop by March')}">${esc(AI.planGoal || '')}</textarea>
          <button type="submit" class="btn btn-primary" ${AI.planBusy ? 'disabled' : ''}>${AI.planBusy ? L('กำลังคิด…', 'Thinking…') : L('ให้ AI วางแผน', 'Plan it')}</button></form>
        <div class="ai-chips">${PLAN_IDEAS().map((s) => `<button type="button" data-goal="${esc(s)}">${esc(s)}</button>`).join('')}</div>`;
      let result = '';
      if (AI.planBusy) result = '<div class="ai-skel"><i style="width:70%"></i><i></i><i style="width:55%"></i></div>';
      else if (AI.planErr) result = `<p class="ai-err">${esc(AI.planErr)}</p>`;
      else if (AI.plan) {
        const rows = AI.plan.items.map((it, i) => {
          const view = { ...it, on_date: it.onDate };
          const done = AI.added.has(i);
          return `<div class="pl-row" style="--c:${catColorOf(it.name)}"><span class="ico sm"><span class="mono">${catMonogram(it.name)}</span></span>
            <span class="pl-info"><span class="n">${esc(it.name)}</span><span class="m">${Planner.ruleText(view)}</span></span>
            <span class="pl-amt ${it.type === 'income' ? 'pos' : ''}">${it.type === 'income' ? '+' : '−'}${fmtMoneyShort(it.amount)}</span>
            <button type="button" class="ai-add ${done ? 'done' : ''}" data-add="${i}" ${done ? 'disabled' : ''}>${done ? L('เพิ่มแล้ว', 'Added') : '+ ' + L('เพิ่ม', 'Add')}</button></div>`;
        }).join('');
        const left = AI.plan.items.filter((_, i) => !AI.added.has(i)).length;
        result = `<div class="ai-plan-out">${rich(AI.plan.summary)}${rows ? `<div class="pl-group">${L('รายการที่ AI เสนอ', 'Suggested items')}</div>${rows}` : ''}
          ${left > 1 ? `<button type="button" class="ai-ghost" id="aiAddAll">${L(`เพิ่มทั้งหมด ${left} รายการ`, `Add all ${left}`)}</button>` : ''}
          <p class="ai-foot">${L('ตรวจดูก่อนเพิ่ม — แก้ไขหรือลบภายหลังได้ในแผนของคุณ', 'Review before adding — you can edit or remove them later')} · ${quotaText()}</p></div>`;
      }
      body = form + result;
    }
    slot.innerHTML = `<section class="glass ai-card ai-plan"><div class="ai-head">${MARK}<div class="ai-ht"><h3>${L('ให้ AI ช่วยวางแผน', 'Plan with AI')}</h3><div class="ax-en">AI PLANNER</div></div></div>${body}</section>`;
    const f = $('aiGoalForm');
    if (f) {
      f.onsubmit = (e) => { e.preventDefault(); askPlan($('aiGoal').value); };
      $('aiGoal').oninput = (e) => { AI.planGoal = e.target.value; };
      $('aiGoal').onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); askPlan($('aiGoal').value); } };
    }
    slot.querySelectorAll('[data-goal]').forEach((b) => (b.onclick = () => askPlan(b.dataset.goal)));
    slot.querySelectorAll('[data-add]').forEach((b) => (b.onclick = async () => {
      b.disabled = true;
      if (await addSuggestion(+b.dataset.add)) { showToast(L('เพิ่มในแผนแล้ว', 'Added to plan'), false); Planner.render(); Planner.homeTile(); }
      renderPlan();
    }));
    const all = $('aiAddAll');
    if (all) all.onclick = async () => {
      all.disabled = true;
      let n = 0;
      for (let i = 0; i < AI.plan.items.length; i++) if (!AI.added.has(i) && (await addSuggestion(i))) n++;
      if (n) showToast(L(`เพิ่ม ${n} รายการในแผนแล้ว`, `Added ${n} items`), false);
      Planner.render(); Planner.homeTile(); renderPlan();
    };
  }

  /* ---------- โปรไฟล์: สวิตช์เปิด/ปิด ---------- */
  function renderProfile() {
    const row = $('aiRow');
    if (!row) return;
    row.style.display = AI.enabled ? '' : 'none';
    $('aiSwitch').classList.toggle('on', AI.consent);
    $('aiStatusText').textContent = AI.consent
      ? L(`เปิดอยู่ · ${quotaText()}`, `On · ${quotaText()}`)
      : L('ปิดอยู่ — ยังไม่ส่งข้อมูลให้ AI', 'Off — nothing is sent to AI');
  }

  function renderAll() {
    const btn = $('aiChatBtn');
    if (btn) btn.hidden = !AI.enabled;
    renderProfile();
    renderAdvice();
    renderPlan();
    renderChat();
    if (insightsVisible()) showInsights(); else renderInsights();
  }

  /* ---------- entry ---------- */
  async function init() {
    try {
      const res = await fetch('/api/ai/status?tzOffset=' + new Date().getTimezoneOffset());
      if (!res.ok) return;
      const s = await res.json();
      Object.assign(AI, { enabled: !!s.enabled, consent: !!s.consent, used: s.used || 0, limit: s.limit || 30, paid: !!s.paid });
    } catch (e) { return; }
    const btn = $('aiChatBtn');
    if (btn) btn.onclick = openChat;
    $('aiSwitch').onclick = () => setConsent(!AI.consent);
    renderAll();
    loadSavedAdvice();
  }
  // เรียกทุกครั้งที่ข้อมูลหรือภาษาเปลี่ยน
  function refresh() {
    if (!AI.enabled) return;
    renderAll();
    loadSavedAdvice();
  }

  window.AIAssist = { init, refresh, showInsights, renderPlan, openChat };
})();
