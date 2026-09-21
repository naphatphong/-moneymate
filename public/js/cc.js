/* cc.js — บัตรเครดิต 3 มิติ (สไตล์อยู่ใน css/ui.css ส่วน .cc)
   CC.build(el, { type, num, holder, holderLabel, valid, validLabel, back })
     back: true = ด้านหลังแบบลายเซ็น, string = HTML ที่จะใส่ใต้แถบแม่เหล็ก, ไม่ใส่ = ไม่มีด้านหลัง
   ถ้าไม่ส่ง opts จะอ่านจาก data-type / data-num / data-back ของ element */
(function () {
  const CONTACTLESS = '<svg viewBox="0 0 24 24"><path d="M8 7.5a6.5 6.5 0 0 1 0 9"/><path d="M11.5 5a10 10 0 0 1 0 14"/><path d="M15 2.6a13.5 13.5 0 0 1 0 18.8"/></svg>';
  const WAVE = '<svg viewBox="0 0 40 24"><path d="M2 16c6-10 10-10 16 0s10 10 20-8"/><path d="M2 21c6-10 10-10 16 0s10 10 20-8" opacity="0.45"/></svg>';
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function build(el, opts) {
    const o = Object.assign({
      type: el.dataset.type || '', num: el.dataset.num || '',
      holder: 'YOUR NAME', holderLabel: 'CARD HOLDER', valid: '09/30', validLabel: 'VALID THRU',
      back: el.dataset.back ? true : null
    }, opts);
    const backInner = o.back === true
      ? `<div class="cc-sign"><span>AUTHORIZED SIGNATURE</span><b>•••</b></div>
         <p class="cc-note">ภาพประกอบเท่านั้น — ใช้บัตรใบไหน ก็บันทึกรายจ่ายลง MoneyMate ได้ในไม่กี่วินาที</p>`
      : o.back;
    el.innerHTML = `<div class="cc-face cc-front"><span class="cc-sheen"></span>
        <div class="cc-row"><span class="cc-type">${esc(o.type)}</span><span class="cc-cl">${CONTACTLESS}</span></div>
        <div class="cc-chip"></div>
        <div class="cc-number">${esc(o.num)}</div>
        <div class="cc-row cc-foot"><div><small>${esc(o.holderLabel)}</small><span class="cc-holder">${esc(o.holder)}</span></div><div><small>${esc(o.validLabel)}</small><span>${esc(o.valid)}</span></div><span class="cc-wave">${WAVE}</span></div>
      </div>` + (backInner ? `<div class="cc-face cc-back"><span class="cc-sheen"></span><div class="cc-stripe"></div>${backInner}</div>` : '');
  }

  window.CC = { build };
})();
