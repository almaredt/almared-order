/* ALMARED Order — mobile order-list builder.
   Works inside the Android WebView wrapper (window.AndroidApp bridge) and in any modern browser. */
(function () {
'use strict';

const $ = id => document.getElementById(id);
const IS_APP = !!window.AndroidApp;
// Persian (۰-۹) and Arabic (٠-٩) digits -> English digits, Persian decimal sign -> '.'
const toEnDigits = v => String(v ?? '').replace(/[۰-۹]/g, d => d.charCodeAt(0) - 1776).replace(/[٠-٩]/g, d => d.charCodeAt(0) - 1632).replace(/٫/g, '.').replace(/٬/g, ',');
const num = v => { const n = parseFloat(toEnDigits(v).replace(/[^0-9.\-]/g, '')); return isFinite(n) ? n : 0; };
// every input field: whatever keyboard is used, digits are stored and shown as 0-9
document.addEventListener('input', e => {
  const el = e.target;
  if (!el || el.tagName !== 'INPUT' || el.type === 'file' || el.type === 'checkbox') return;
  const fixed = toEnDigits(el.value);
  if (fixed !== el.value) {
    let pos = null; try { pos = el.selectionStart; } catch (x) {}
    el.value = fixed;
    if (pos != null) { try { el.setSelectionRange(pos, pos); } catch (x) {} }
  }
}, true);
const fmt = n => (Math.round((+n || 0) * 100) / 100).toLocaleString('en-US', { maximumFractionDigits: 2 });
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const MONTHS = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const today = () => { const d = new Date(); return d.getFullYear() + '/' + MONTHS[d.getMonth()] + '/' + String(d.getDate()).padStart(2, '0'); };

/* ---------------- settings ---------------- */
const DEF_SETTINGS = { title: 'OR INVOICE', buyer: 'ALMARED TRADING L.L.C', pobox: '15043', cur: 'T', desc: 'PLASTIC TOYS', comm: 3 };
let SET = { ...DEF_SETTINGS };
try { Object.assign(SET, JSON.parse(localStorage.getItem('ol.settings') || '{}')); } catch (e) {}
const saveSettings = () => { try { localStorage.setItem('ol.settings', JSON.stringify(SET)); } catch (e) {} };

/* ---------------- model ---------------- */
const newRow = () => ({ id: uid(), img: '', code: '', desc: SET.desc, unit: 0, ctn: 0, qty: 0, qtyManual: false, price: 0 });
const qtyOf = r => r.qtyManual ? num(r.qty) : num(r.unit) * num(r.ctn);
const totOf = r => qtyOf(r) * num(r.price);
function totals(o) {
  let ctn = 0, qty = 0, sum = 0;
  o.rows.forEach(r => { ctn += num(r.ctn); qty += qtyOf(r); sum += totOf(r); });
  const comm = Math.round(sum * num(o.commPct) / 100), transit = num(o.transit);
  return { ctn, qty, sum, comm, transit, final: sum + transit + comm };
}
function newOrder() {
  const nums = ORDERS.map(o => parseInt(o.meta.invNo, 10)).filter(n => isFinite(n));
  return {
    id: uid(), created: Date.now(), updated: Date.now(),
    meta: { title: SET.title, buyer: SET.buyer, pobox: SET.pobox, invNo: nums.length ? String(Math.max(...nums) + 1) : '1', date: today(), cont1: '', cont2: '', cur: SET.cur },
    transit: 0, commPct: num(SET.comm), rows: []
  };
}
function normalizeOrder(d) {
  const o = newOrder();
  o.meta = Object.assign(o.meta, d.meta || {});
  o.transit = num(d.transit); o.commPct = d.commPct == null ? o.commPct : num(d.commPct);
  o.rows = (d.rows || []).map(r => Object.assign(newRow(), r, { id: uid() }));
  return o;
}
function nextCode(c) {
  const m = String(c || '').match(/^(.*?)(\d+)(\D*)$/);
  if (!m) return c || '';
  const n = String(parseInt(m[2], 10) + 1).padStart(m[2].length, '0');
  return m[1] + n + m[3];
}

/* ---------------- storage (IndexedDB) ---------------- */
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const q = indexedDB.open('almared-orderlist', 1);
      q.onupgradeneeded = () => q.result.createObjectStore('orders', { keyPath: 'id' });
      q.onsuccess = () => { this.db = q.result; res(); };
      q.onerror = () => rej(q.error);
    });
  },
  req(mode, fn) {
    return new Promise((res, rej) => {
      if (!this.db) return res(mode === 'readonly' ? [] : undefined);
      const q = fn(this.db.transaction('orders', mode).objectStore('orders'));
      q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error);
    });
  },
  all() { return this.req('readonly', s => s.getAll()); },
  put(o) { return this.req('readwrite', s => s.put(o)); },
  del(id) { return this.req('readwrite', s => s.delete(id)); }
};

let ORDERS = [];
let CUR = null;
let saveTimer = null;
function save(now) {
  if (!CUR) return;
  CUR.updated = Date.now();
  clearTimeout(saveTimer);
  const o = CUR;
  const run = () => DB.put(o).catch(() => toast('ذخیره نشد — فضای گوشی را بررسی کنید'));
  if (now) run(); else saveTimer = setTimeout(run, 350);
}

/* ---------------- UI helpers ---------------- */
let toastTimer;
function toast(msg, actLabel, act) {
  $('toastMsg').textContent = msg;
  const b = $('toastAct');
  b.hidden = !actLabel; b.textContent = actLabel || ''; b.onclick = () => { $('toast').classList.remove('on'); act && act(); };
  $('toast').classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').classList.remove('on'), actLabel ? 6000 : 2600);
}
const busy = (on, msg) => { $('busy').hidden = !on; if (msg) $('busyMsg').textContent = msg; };

let openSheetId = null;
function openSheet(id) {
  if (openSheetId) $(openSheetId).hidden = true;
  openSheetId = id; $('scrim').hidden = false; $(id).hidden = false; $(id).scrollTop = 0;
}
function closeSheet() {
  if (!openSheetId) return;
  const id = openSheetId; openSheetId = null;
  $(id).hidden = true; $('scrim').hidden = true;
  if (id === 'sItem') onItemSheetClosed();
}
$('scrim').onclick = closeSheet;

let confirmFn = null;
function confirmBox(title, msg, yesLabel, fn) {
  $('cfTitle').textContent = title; $('cfMsg').textContent = msg; $('cfYes').textContent = yesLabel || 'بله';
  confirmFn = fn; openSheet('sConfirm');
}
$('cfYes').onclick = () => { const f = confirmFn; confirmFn = null; closeSheet(); f && f(); };
$('cfNo').onclick = closeSheet;

function menu(items) {
  $('menuList').innerHTML = items.map((it, i) => `<button data-i="${i}" class="${it.warn ? 'warn' : ''}"><i>${it.icon || ''}</i>${esc(it.label)}</button>`).join('');
  $('menuList').querySelectorAll('button').forEach(b => b.onclick = () => { const it = items[+b.dataset.i]; closeSheet(); it.fn && it.fn(); });
  openSheet('sMenu');
}

function showView(id) {
  ['vHome', 'vOrder', 'vCam'].forEach(v => $(v).hidden = v !== id);
}

/* numeric inputs: raw while editing, formatted at rest */
document.addEventListener('focusin', e => { const el = e.target; if (el.classList && el.classList.contains('num')) el.value = el.value ? String(num(el.value)) : ''; });
document.addEventListener('focusout', e => { const el = e.target; if (el.classList && el.classList.contains('num')) el.value = el.value ? fmt(num(el.value)) : ''; });
const setNum = (el, v) => { el.value = v ? fmt(v) : ''; };

/* ---------------- images ---------------- */
function loadImage(src) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
}
function toJpeg(source, w, h, max) {
  const k = Math.min(1, max / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * k); c.height = Math.round(h * k);
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  x.drawImage(source, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}
async function fileToImg(file, max = 1000) {
  const url = URL.createObjectURL(file);
  try { const im = await loadImage(url); return toJpeg(im, im.naturalWidth, im.naturalHeight, max); }
  finally { URL.revokeObjectURL(url); }
}

/* =============================================================
   HOME
   ============================================================= */
function renderHome() {
  const q = $('hSearch').value.trim().toLowerCase();
  const list = ORDERS.slice().sort((a, b) => b.updated - a.updated).filter(o => {
    if (!q) return true;
    const hay = [o.meta.title, o.meta.invNo, o.meta.date, o.meta.cont1, o.meta.cont2, o.meta.buyer, ...o.rows.map(r => r.code)].join(' ').toLowerCase();
    return hay.includes(q);
  });
  if (!list.length) {
    $('hList').innerHTML = `<div class="homeempty">${q ? 'سفارشی با این عبارت پیدا نشد.' : 'هنوز سفارشی ندارید.<br>با «سفارش جدید» شروع کنید.'}</div>`;
    return;
  }
  $('hList').innerHTML = list.map(o => {
    const t = totals(o), imgs = o.rows.filter(r => r.img).slice(0, 4);
    const thumbs = imgs.length ? imgs.map(r => `<img src="${r.img}" alt="">`).join('') : `<span class="ph">#${esc(o.meta.invNo)}</span>`;
    return `<button class="ocard" data-id="${o.id}">
      <span class="othumbs ${imgs.length === 1 ? 'one' : ''}">${thumbs}</span>
      <span class="oinfo">
        <span class="t">${esc(o.meta.title)} NO:${esc(o.meta.invNo)}</span>
        <span class="s">${esc(o.meta.date)}${o.meta.cont1 ? ' · ' + esc(o.meta.cont1) : ''}</span>
        <span class="m"><span><b>${o.rows.length}</b> ردیف</span><span><b>${fmt(t.ctn)}</b> کارتن</span><span><b>${fmt(t.final)}</b> ${esc(o.meta.cur)}</span></span>
      </span></button>`;
  }).join('');
  $('hList').querySelectorAll('.ocard').forEach(b => b.onclick = () => openOrder(b.dataset.id));
}
$('hSearch').addEventListener('input', renderHome);
$('hNew').onclick = async () => {
  const o = newOrder(); ORDERS.push(o); CUR = o; await DB.put(o).catch(() => {});
  openOrder(o.id, true);
};
$('hMenu').onclick = () => menu([
  { icon: '⚙', label: 'پیش‌فرض‌ها (خریدار، ارز، کمیسیون…)', fn: openSettings },
  { icon: '📂', label: 'باز کردن فایل پشتیبان (.json)', fn: () => { $('fJson').value = ''; $('fJson').click(); } }
]);
$('fJson').addEventListener('change', e => {
  const f = e.target.files[0]; if (!f) return;
  const rd = new FileReader();
  rd.onload = async () => {
    try {
      const d = JSON.parse(rd.result); if (!d || !Array.isArray(d.rows)) throw 0;
      const o = normalizeOrder(d); ORDERS.push(o); await DB.put(o); renderHome(); openOrder(o.id);
      toast('سفارش باز شد');
    } catch (x) { toast('این فایل، فایل سفارش نیست'); }
  };
  rd.readAsText(f);
});

function openSettings() {
  $('st_title').value = SET.title; $('st_buyer').value = SET.buyer; $('st_pobox').value = SET.pobox;
  $('st_cur').value = SET.cur; $('st_desc').value = SET.desc; $('st_comm').value = SET.comm;
  openSheet('sSettings');
}
$('stSave').onclick = () => {
  SET = { title: $('st_title').value, buyer: $('st_buyer').value, pobox: $('st_pobox').value, cur: $('st_cur').value, desc: $('st_desc').value, comm: num($('st_comm').value) };
  saveSettings(); closeSheet(); toast('پیش‌فرض‌ها ذخیره شد');
};

/* =============================================================
   ORDER
   ============================================================= */
const META_KEYS = ['title', 'invNo', 'date', 'buyer', 'pobox', 'cur', 'cont1', 'cont2'];
function openOrder(id, isNew) {
  CUR = ORDERS.find(o => o.id === id); if (!CUR) return;
  META_KEYS.forEach(k => $('mt_' + k).value = CUR.meta[k] ?? '');
  setNum($('mt_transit'), CUR.transit); $('mt_comm').value = CUR.commPct ?? 0;
  $('oMeta').open = !!isNew;
  renderOrderHead(); renderItems(); showView('vOrder');
  $('oScroll').scrollTop = 0;
}
function renderOrderHead() {
  const m = CUR.meta;
  $('oTitle').textContent = `${m.title} NO:${m.invNo}`;
  $('oSub').innerHTML = `<bdi dir="ltr">${esc(m.date)}</bdi> · ${CUR.rows.length} ردیف`;
  $('oMetaSum').textContent = [m.buyer, m.cont1, m.cont2].filter(Boolean).join(' · ');
}
META_KEYS.forEach(k => $('mt_' + k).addEventListener('input', e => { CUR.meta[k] = e.target.value; renderOrderHead(); renderTotals(); save(); }));
$('mt_transit').addEventListener('input', e => { CUR.transit = num(e.target.value); renderTotals(); save(); });
$('mt_comm').addEventListener('input', e => { CUR.commPct = num(e.target.value); renderTotals(); save(); });

function cardHTML(r, i) {
  const cur = esc(CUR.meta.cur), q = qtyOf(r);
  return `<span class="no">${i + 1}</span>
    <span class="pic">${r.img ? `<img src="${r.img}" alt="" loading="lazy">` : '＋'}</span>
    <span class="body">
      ${r.code ? `<span class="code">${esc(r.code)}</span>` : `<span class="code miss">بدون کد — برای ویرایش بزنید</span>`}
      <span class="calc"><b>${fmt(r.unit)}</b> × ${fmt(r.ctn)} = <b>${fmt(q)}</b>${r.qtyManual ? '*' : ''} &nbsp;@ ${fmt(r.price)}</span>
      <span class="tot">${fmt(totOf(r))} <small>${cur}</small></span>
    </span>`;
}
function renderItems() {
  const box = $('oItems');
  box.innerHTML = CUR.rows.map((r, i) => {
    const warn = !r.code || !num(r.price) || !qtyOf(r);
    return `<button class="icard${warn ? ' warn' : ''}" data-i="${i}">${cardHTML(r, i)}</button>`;
  }).join('');
  $('oEmpty').hidden = CUR.rows.length > 0;
  renderOrderHead(); renderTotals();
}
function updateCard(i) {
  const el = $('oItems').children[i]; if (!el) return renderItems();
  const r = CUR.rows[i];
  el.innerHTML = cardHTML(r, i);
  el.classList.toggle('warn', !r.code || !num(r.price) || !qtyOf(r));
  renderTotals();
}
function renderTotals() {
  const t = totals(CUR);
  $('tCtn').textContent = fmt(t.ctn); $('tQty').textContent = fmt(t.qty); $('tFinal').textContent = fmt(t.final);
}
$('oItems').addEventListener('click', e => { const c = e.target.closest('.icard'); if (c) openItem(+c.dataset.i); });
$('oBack').onclick = goHome;
function goHome() { save(true); CUR = null; renderHome(); showView('vHome'); }
$('oAdd').onclick = () => { const r = newRow(); const prev = lastWithCode(); if (prev) { r.code = nextCode(prev.code); r.unit = prev.unit; } CUR.rows.push(r); save(); renderItems(); openItem(CUR.rows.length - 1); };
$('oGallery').onclick = () => { camTarget = null; $('fGal').value = ''; $('fGal').click(); };
$('oTotals').onclick = () => {
  const t = totals(CUR), c = esc(CUR.meta.cur);
  $('menuList').innerHTML = `<div dir="ltr" style="display:flex;flex-direction:column;gap:2px;font-variant-numeric:tabular-nums">
    ${[['GRAND TOTAL', t.sum], ['TRANZIT AND COST', t.transit], [`COMMISSION (${fmt(CUR.commPct)}%)`, t.comm]].map(([l, v]) =>
      `<div style="display:flex;justify-content:space-between;padding:12px 4px;border-bottom:1px solid var(--line)"><span style="color:var(--muted);font-weight:700;font-size:13px">${l}</span><b>${fmt(v)}</b></div>`).join('')}
    <div style="display:flex;justify-content:space-between;padding:14px 12px;background:var(--peach);border-radius:12px;margin-top:8px"><span style="font-weight:800">TOTAL</span><b style="font-size:20px">${fmt(t.final)} <small style="font-weight:400">${c}</small></b></div>
    <div style="display:flex;justify-content:space-between;padding:10px 4px;color:var(--muted);font-size:13px"><span>CTN ${fmt(t.ctn)}</span><span>QTY ${fmt(t.qty)}</span><span>${CUR.rows.length} items</span></div>
  </div>`;
  openSheet('sMenu');
};
$('oMenu').onclick = () => menu([
  { icon: '✎', label: 'ویرایش مشخصات فاکتور', fn: () => { $('oMeta').open = true; $('oScroll').scrollTop = 0; } },
  { icon: '⧉', label: 'کپی این سفارش (سفارش جدید با همین کالاها)', fn: duplicateOrder },
  { icon: '🗑', label: 'حذف این سفارش', warn: true, fn: () => confirmBox('حذف سفارش', `سفارش شماره ${CUR.meta.invNo} با ${CUR.rows.length} ردیف برای همیشه حذف شود؟`, 'حذف', deleteOrder) }
]);
async function duplicateOrder() {
  const o = normalizeOrder(JSON.parse(JSON.stringify(CUR)));
  const nums = ORDERS.map(x => parseInt(x.meta.invNo, 10)).filter(n => isFinite(n));
  o.meta.invNo = nums.length ? String(Math.max(...nums) + 1) : CUR.meta.invNo + '-2'; o.meta.date = today();
  ORDERS.push(o); await DB.put(o).catch(() => {}); openOrder(o.id, true); toast('کپی ساخته شد');
}
async function deleteOrder() {
  const id = CUR.id; await DB.del(id).catch(() => {});
  ORDERS = ORDERS.filter(o => o.id !== id); CUR = null; renderHome(); showView('vHome'); toast('سفارش حذف شد');
}
const lastWithCode = (before) => { const rows = CUR.rows.slice(0, before == null ? CUR.rows.length : before); for (let i = rows.length - 1; i >= 0; i--) if (rows[i].code) return rows[i]; return null; };

/* ---------------- item sheet ---------------- */
let EI = -1;
function openItem(i) {
  EI = i; const r = CUR.rows[i];
  $('i_code').value = r.code; $('i_desc').value = r.desc;
  setNum($('i_unit'), r.unit); setNum($('i_ctn'), r.ctn); setNum($('i_price'), r.price);
  $('i_cur').textContent = CUR.meta.cur;
  fillItemCalc(); fillItemPhoto();
  openSheet('sItem');
}
function fillItemPhoto() { const r = CUR.rows[EI]; $('iPhoto').innerHTML = r.img ? `<img src="${r.img}" alt="">` : '📷'; $('iNoPhoto').hidden = !r.img; }
function fillItemCalc() {
  const r = CUR.rows[EI], q = $('i_qty');
  if (document.activeElement !== q) setNum(q, qtyOf(r));
  q.classList.toggle('manual', !!r.qtyManual);
  $('i_qtyHint').textContent = r.qtyManual ? 'دستی' : '= Unit × Ctn';
  $('i_total').textContent = fmt(totOf(r)) + ' ' + CUR.meta.cur;
}
['code', 'desc'].forEach(k => $('i_' + k).addEventListener('input', e => { CUR.rows[EI][k] = e.target.value; updateCard(EI); save(); }));
['unit', 'ctn', 'price'].forEach(k => $('i_' + k).addEventListener('input', e => {
  const r = CUR.rows[EI]; r[k] = num(e.target.value); if (k !== 'price') r.qtyManual = false;
  fillItemCalc(); updateCard(EI); save();
}));
$('i_qty').addEventListener('input', e => { const r = CUR.rows[EI]; r.qty = num(e.target.value); r.qtyManual = e.target.value.trim() !== ''; fillItemCalc(); updateCard(EI); save(); });
$('i_code').addEventListener('keydown', e => { if (e.key === 'Enter') $('i_unit').focus(); });
$('i_unit').addEventListener('keydown', e => { if (e.key === 'Enter') $('i_ctn').focus(); });
$('i_ctn').addEventListener('keydown', e => { if (e.key === 'Enter') $('i_price').focus(); });
$('i_price').addEventListener('keydown', e => { if (e.key === 'Enter') closeSheet(); });
$('iDone').onclick = closeSheet;
function onItemSheetClosed() {
  if (EI >= 0 && CUR) { const el = $('oItems').children[EI]; if (el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); } }
  document.activeElement && document.activeElement.blur && document.activeElement.blur();
  EI = -1;
}
$('iDel').onclick = () => {
  const i = EI; const removed = CUR.rows[i]; closeSheet();
  CUR.rows.splice(i, 1); save(); renderItems();
  const order = CUR;
  toast('ردیف ' + (i + 1) + ' حذف شد', 'برگردان', () => { if (CUR === order) { CUR.rows.splice(i, 0, removed); save(); renderItems(); } });
};
$('iDup').onclick = () => { const i = EI; const c = JSON.parse(JSON.stringify(CUR.rows[i])); c.id = uid(); c.code = nextCode(c.code); CUR.rows.splice(i + 1, 0, c); save(); renderItems(); openItem(i + 1); toast('کپی ردیف ساخته شد'); };
$('iUp').onclick = () => moveItem(-1);
$('iDown').onclick = () => moveItem(1);
function moveItem(d) {
  const i = EI, j = i + d; if (j < 0 || j >= CUR.rows.length) return;
  [CUR.rows[i], CUR.rows[j]] = [CUR.rows[j], CUR.rows[i]]; EI = j; save(); renderItems();
  const el = $('oItems').children[j]; el && el.scrollIntoView({ block: 'center' });
}
$('iPhoto').onclick = () => { camTarget = EI; $('fOne').value = ''; $('fOne').click(); };
$('iPick').onclick = $('iPhoto').onclick;
$('iRetake').onclick = () => { camTarget = EI; $('fCam').value = ''; $('fCam').click(); };
$('iNoPhoto').onclick = () => { CUR.rows[EI].img = ''; fillItemPhoto(); updateCard(EI); save(); };

/* ---------------- file inputs ---------------- */
let camTarget = null; // null = new row, number = replace that row's photo
async function handleFiles(files) {
  files = [...files].filter(f => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic)$/i.test(f.name));
  if (!files.length) return;
  if (camTarget != null && CUR.rows[camTarget]) {
    busy(true, 'در حال آماده‌سازی عکس…');
    try { CUR.rows[camTarget].img = await fileToImg(files[0]); } catch (e) { toast('این عکس خوانده نشد'); }
    busy(false); save(); updateCard(camTarget); if (EI === camTarget) fillItemPhoto();
    return;
  }
  busy(true, `در حال افزودن ${files.length} عکس…`);
  let added = 0, prev = lastWithCode();
  for (const f of files) {
    try {
      const r = newRow(); r.img = await fileToImg(f);
      if (prev) { r.code = nextCode(prev.code); r.unit = prev.unit; prev = r; }
      CUR.rows.push(r); added++;
    } catch (e) {}
  }
  busy(false); save(); renderItems();
  if (added === 1) openItem(CUR.rows.length - 1);
  else { toast(added + ' ردیف با عکس اضافه شد'); $('oScroll').scrollTop = $('oScroll').scrollHeight; }
}
['fCam', 'fGal', 'fOne'].forEach(id => $(id).addEventListener('change', e => handleFiles(e.target.files)));

/* =============================================================
   RAPID CAMERA
   ============================================================= */
let stream = null, shots = 0, pendingRow = null, torchOn = false;
const video = $('camVideo');
async function openCam() {
  if (!CUR) return;
  shots = 0; $('camCount').textContent = '0 عکس'; $('camThumb').style.backgroundImage = '';
  $('camQuick').hidden = true; $('camBot').hidden = false; $('camErr').hidden = true; $('camTorch').hidden = true;
  showView('vCam');
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return camFail('این دستگاه دوربین زنده را پشتیبانی نمی‌کند.');
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } } });
    video.srcObject = stream; await video.play().catch(() => {});
    const track = stream.getVideoTracks()[0];
    const caps = track.getCapabilities ? track.getCapabilities() : {};
    if (caps.torch) { $('camTorch').hidden = false; torchOn = false; $('camTorch').classList.remove('on'); }
  } catch (e) {
    camFail(e && e.name === 'NotAllowedError' ? 'اجازهٔ دوربین داده نشد. از تنظیمات گوشی، دسترسی دوربین را برای اپ روشن کنید.' : 'دوربین باز نشد.');
  }
}
function camFail(msg) { $('camErrMsg').textContent = msg; $('camErr').hidden = false; $('camBot').hidden = true; }
function stopCam() { if (stream) stream.getTracks().forEach(t => t.stop()); stream = null; video.srcObject = null; }
function closeCam() {
  if (pendingRow) applyQuick();
  stopCam(); showView('vOrder'); renderItems();
  if (shots) { toast(shots + ' کالا اضافه شد'); $('oScroll').scrollTop = $('oScroll').scrollHeight; }
}
$('oCam').onclick = openCam;
$('camClose').onclick = closeCam;
$('camFallback').onclick = () => { stopCam(); showView('vOrder'); camTarget = null; $('fCam').value = ''; $('fCam').click(); };
$('camTorch').onclick = async () => {
  const t = stream && stream.getVideoTracks()[0]; if (!t) return;
  try { torchOn = !torchOn; await t.applyConstraints({ advanced: [{ torch: torchOn }] }); $('camTorch').classList.toggle('on', torchOn); } catch (e) { torchOn = false; }
};
$('camShutter').onclick = () => {
  if (!video.videoWidth) return;
  const img = toJpeg(video, video.videoWidth, video.videoHeight, 1000);
  const f = $('camFlash'); f.classList.remove('on'); void f.offsetWidth; f.classList.add('on');
  try { navigator.vibrate && navigator.vibrate(25); } catch (e) {}
  const prev = lastWithCode();
  const r = newRow(); r.img = img;
  CUR.rows.push(r); shots++; save();
  $('camCount').textContent = shots + ' عکس';
  $('camThumb').style.backgroundImage = `url("${img}")`;
  if ($('camAsk').checked) {
    pendingRow = r;
    $('qThumb').src = img;
    $('q_code').value = prev ? nextCode(prev.code) : '';
    $('q_unit').value = prev && prev.unit ? prev.unit : '';
    $('q_ctn').value = ''; $('q_price').value = '';
    $('camBot').hidden = true; $('camQuick').hidden = false;
    setTimeout(() => { $('q_ctn').value === '' && $('q_code').value ? $('q_unit').focus() : $('q_code').focus(); }, 60);
  } else if (prev) { r.code = nextCode(prev.code); r.unit = prev.unit; }
};
function applyQuick() {
  const r = pendingRow; if (!r) return; pendingRow = null;
  r.code = $('q_code').value.trim(); r.unit = num($('q_unit').value); r.ctn = num($('q_ctn').value); r.price = num($('q_price').value);
  save();
}
$('qNext').onclick = () => { applyQuick(); document.activeElement && document.activeElement.blur(); $('camQuick').hidden = true; $('camBot').hidden = false; };
$('qDone').onclick = () => { applyQuick(); closeCam(); };
['q_code', 'q_unit', 'q_ctn'].forEach((id, k, arr) => $(id).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $(['q_unit', 'q_ctn', 'q_price'][k]).focus(); } }));
$('q_price').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('qNext').click(); } });
$('camThumb').onclick = () => { if (!shots) return; closeCam(); openItem(CUR.rows.length - 1); };
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { save(true); }
  else if (!$('vCam').hidden && !stream && $('camErr').hidden) openCam();
});

/* =============================================================
   DOCUMENT (print / PDF)
   ============================================================= */
const SHEET_CSS = `
.pg{direction:ltr;text-align:left;width:794px;height:1123px;padding:30px;box-sizing:border-box;background:#fff;color:#000;font-family:Calibri,Carlito,Arial,"Vazirmatn",sans-serif;overflow:hidden;position:relative}
.pg h1{text-align:center;font-size:25px;margin:6px 0 12px}
.pg .m{display:flex;justify-content:space-between;font-weight:700;font-size:13px;line-height:1.55}
.pg .cont{margin:12px 0 10px}
.pg table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:12px;font-variant-numeric:tabular-nums}
.pg th{text-align:center;background:#ED7D31;color:#fff;border:1px solid #000;height:32px;padding:0 3px;font-weight:700;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.pg td{border:1px solid #000;height:56px;padding:2px 4px;text-align:center;overflow:hidden;word-break:break-word}
.pg tr.z td{background:#FCE4D6;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.pg td.im{padding:2px}
.pg td.im img{max-width:80px;max-height:50px;display:block;margin:auto}
.pg td.b{font-weight:700}
.pg td.d{font-size:10.5px;font-weight:700}
.pg td.r{text-align:right}
.pg tr.f td{height:26px;font-weight:700}
.pg tr.f td.l{text-align:left;font-size:12px}
.pg tr.f.g td.l{font-size:17px;font-weight:400}
.pg tr.f.fin td{font-size:14px}
.pg .pn{position:absolute;bottom:12px;left:0;right:0;text-align:center;font-size:10px;color:#777}`;
const COLS = `<colgroup><col style="width:34px"><col style="width:88px"><col style="width:78px"><col style="width:100px"><col style="width:44px"><col style="width:44px"><col style="width:56px"><col style="width:122px"><col style="width:168px"></colgroup>`;

function sheetPages(o) {
  const m = o.meta, t = totals(o), cur = esc(m.cur);
  const PH = 1123 - 60 - 24, HEAD = 156, TH = 32, RH = 56, FOOT = 26 * 4 + 6;
  const rows = o.rows.map((r, i) => ({ r, i }));
  const pages = []; let cur_ = [], cap = Math.floor((PH - HEAD - TH) / RH);
  rows.forEach(x => { if (cur_.length >= cap) { pages.push(cur_); cur_ = []; cap = Math.floor((PH - TH) / RH); } cur_.push(x); });
  pages.push(cur_);
  const lastUsed = (pages.length === 1 ? HEAD : 0) + TH + cur_.length * RH;
  const footOwn = lastUsed + FOOT > PH;
  const head = `<h1>${esc(m.title)}</h1>
    <div class="m"><span>BUYER:${esc(m.buyer)}</span><span>${esc(m.title)} NO:${esc(m.invNo)}</span></div>
    <div class="m"><span>P.O BOX:${esc(m.pobox)}</span><span>DATE:${esc(m.date)}</span></div>
    <div class="m cont"><span>${m.cont1 ? 'Container No:' + esc(m.cont1) : ''}</span><span>${m.cont2 ? 'Container No:' + esc(m.cont2) : ''}</span></div>`;
  const thead = `<thead><tr><th>No</th><th>Picture</th><th>Code</th><th>Description</th><th>Unit</th><th>Ctn</th><th>QTY</th><th>Price ${cur}</th><th>Total Price</th></tr></thead>`;
  const rowHTML = ({ r, i }) => `<tr class="${i % 2 === 0 ? 'z' : ''}"><td>${i + 1}</td><td class="im">${r.img ? `<img src="${r.img}">` : ''}</td><td class="b">${esc(r.code)}</td><td class="d">${esc(r.desc)}</td><td class="b">${fmt(r.unit)}</td><td>${fmt(r.ctn)}</td><td>${fmt(qtyOf(r))}</td><td>${fmt(r.price)}</td><td>${fmt(totOf(r))}</td></tr>`;
  const e5 = '<td></td><td></td><td></td><td></td><td></td>';
  const foot = `<tr class="f g"><td></td><td colspan="4" class="l">GRAND TOTAL</td><td>${fmt(t.ctn)}</td><td>${fmt(t.qty)}</td><td></td><td class="r">${fmt(t.sum)}</td></tr>
    <tr class="f z">${e5}<td colspan="3" class="l">TRANZIT AND COST:</td><td class="r">${fmt(t.transit)}</td></tr>
    <tr class="f">${e5}<td colspan="3" class="l">COMMISSION${num(o.commPct) ? ' (' + fmt(o.commPct) + '%)' : ''}:</td><td class="r">${fmt(t.comm)}</td></tr>
    <tr class="f z fin">${e5}<td colspan="3" class="l">TOTAL:</td><td class="r">${fmt(t.final)}</td></tr>`;
  const total = pages.length + (footOwn ? 1 : 0);
  const out = pages.map((p, k) => {
    const isLast = k === pages.length - 1;
    return `<div class="pg">${k === 0 ? head : ''}<table>${COLS}${thead}<tbody>${p.map(rowHTML).join('')}${isLast && !footOwn ? foot : ''}</tbody></table>${total > 1 ? `<div class="pn">${k + 1} / ${total}</div>` : ''}</div>`;
  });
  if (footOwn) out.push(`<div class="pg"><table>${COLS}<tbody>${foot}</tbody></table><div class="pn">${total} / ${total}</div></div>`);
  return out;
}
function printDoc(o) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(baseName(o))}</title><style>@page{size:A4;margin:0}html,body{margin:0;padding:0;background:#fff}${SHEET_CSS}
    .pg{page-break-after:always;break-after:page}.pg:last-child{page-break-after:auto;break-after:auto}</style></head><body>${sheetPages(o).join('')}</body></html>`;
}
const baseName = o => ((o.meta.title || 'ORDER') + '_' + (o.meta.invNo || '')).replace(/[^\w\-]+/g, '_').replace(/_+$/, '');

async function makePdf(o) {
  if (!window.jspdf || !window.html2canvas) throw new Error('lib');
  const hold = $('sheetHold'), pages = sheetPages(o);
  const pdf = new window.jspdf.jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  for (let k = 0; k < pages.length; k++) {
    busy(true, `ساخت PDF — صفحهٔ ${k + 1} از ${pages.length}`);
    hold.innerHTML = `<style>${SHEET_CSS}</style>${pages[k]}`;
    await Promise.all([...hold.querySelectorAll('img')].map(im => im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r; })));
    const canvas = await window.html2canvas(hold.querySelector('.pg'), { scale: 2, backgroundColor: '#ffffff', logging: false, windowWidth: 794 });
    if (k) pdf.addPage();
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.9), 'JPEG', 0, 0, 210, 297);
  }
  hold.innerHTML = '';
  return pdf.output('blob');
}

/* =============================================================
   EXCEL
   ============================================================= */
async function makeXlsx(o) {
  if (!window.ExcelJS) throw new Error('lib');
  const m = o.meta, t = totals(o);
  const wb = new ExcelJS.Workbook(); wb.creator = 'ALMARED Order';
  const ws = wb.addWorksheet('Order', { pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.columns = [{ width: 5 }, { width: 14 }, { width: 12 }, { width: 17 }, { width: 7 }, { width: 7 }, { width: 8 }, { width: 13 }, { width: 16 }];
  const thin = { style: 'thin', color: { argb: 'FF000000' } }, box = { top: thin, left: thin, bottom: thin, right: thin };
  const fill = c => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: c } });
  const NF = '#,##0';
  ws.mergeCells('A1:I1'); ws.getCell('A1').value = m.title; ws.getCell('A1').font = { bold: true, size: 18 }; ws.getCell('A1').alignment = { horizontal: 'center' }; ws.getRow(1).height = 28;
  [[2, 'BUYER:' + m.buyer, m.title + ' NO:' + m.invNo], [3, 'P.O BOX:' + m.pobox, 'DATE:' + m.date], [4, m.cont1 ? 'Container No:' + m.cont1 : '', m.cont2 ? 'Container No:' + m.cont2 : '']]
    .forEach(([r, a, b]) => { ws.mergeCells(`A${r}:E${r}`); ws.mergeCells(`G${r}:I${r}`); ws.getCell('A' + r).value = a; ws.getCell('G' + r).value = b; ws.getCell('A' + r).font = { bold: true }; ws.getCell('G' + r).font = { bold: true }; });
  const H = 6, CELL_W = 103, CELL_H = 64; // picture column ≈ 103 px wide, data rows 48 pt ≈ 64 px
  const sizes = await Promise.all(o.rows.map(r => r.img ? loadImage(r.img).then(im => ({ w: im.naturalWidth, h: im.naturalHeight })).catch(() => null) : null));
  ws.getRow(H).values = ['No', 'Picture', 'Code', 'Description', 'Unit', 'Ctn', 'QTY', 'Price ' + (m.cur || ''), 'Total Price'];
  ws.getRow(H).eachCell(c => { c.fill = fill('FFED7D31'); c.font = { bold: true, color: { argb: 'FFFFFFFF' } }; c.border = box; c.alignment = { horizontal: 'center', vertical: 'middle' }; });
  ws.getRow(H).height = 22;
  o.rows.forEach((r, i) => {
    const n = H + 1 + i, row = ws.getRow(n);
    row.values = [i + 1, '', r.code, r.desc, num(r.unit), num(r.ctn),
      r.qtyManual ? num(r.qty) : { formula: `E${n}*F${n}`, result: qtyOf(r) }, num(r.price), { formula: `G${n}*H${n}`, result: totOf(r) }];
    row.height = 48;
    for (let c = 1; c <= 9; c++) { const cl = row.getCell(c); cl.border = box; cl.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }; if (i % 2 === 0) cl.fill = fill('FFFCE4D6'); }
    row.getCell(3).font = { bold: true }; row.getCell(5).font = { bold: true }; row.getCell(4).font = { bold: true, size: 9 };
    [5, 6, 7, 8, 9].forEach(c => row.getCell(c).numFmt = NF);
    if (r.img) {
      // two-cell anchor (tl + br) so Google Sheets / WPS / Excel mobile all show the picture
      const id = wb.addImage({ base64: r.img, extension: 'jpeg' });
      const sz = sizes[i] || { w: 4, h: 3 };
      const boxW = 96, boxH = 58, k = Math.min(boxW / sz.w, boxH / sz.h);
      const w = sz.w * k, h = sz.h * k, x = (CELL_W - w) / 2, y = (CELL_H - h) / 2, EMU = 9525; // exact EMU offsets inside cell B
      ws.addImage(id, {
        tl: { nativeCol: 1, nativeColOff: Math.round(x * EMU), nativeRow: n - 1, nativeRowOff: Math.round(y * EMU) },
        br: { nativeCol: 1, nativeColOff: Math.round((x + w) * EMU), nativeRow: n - 1, nativeRowOff: Math.round((y + h) * EMU) },
        editAs: 'oneCell'
      });
    }
  });
  const last = H + Math.max(o.rows.length, 1), g = last + 1;
  ws.mergeCells(`B${g}:E${g}`); ws.getCell('B' + g).value = 'GRAND TOTAL'; ws.getCell('B' + g).font = { size: 14 };
  ws.getCell('F' + g).value = { formula: `SUM(F${H + 1}:F${last})`, result: t.ctn };
  ws.getCell('G' + g).value = { formula: `SUM(G${H + 1}:G${last})`, result: t.qty };
  ws.getCell('I' + g).value = { formula: `SUM(I${H + 1}:I${last})`, result: t.sum };
  for (let c = 1; c <= 9; c++) { const cl = ws.getRow(g).getCell(c); cl.border = box; cl.numFmt = NF; cl.alignment = { horizontal: c === 2 ? 'left' : 'center', vertical: 'middle' }; }
  ws.getCell('I' + g).font = { bold: true };
  const fr = (n, label, val, alt, big) => {
    ws.mergeCells(`F${n}:H${n}`); ws.getCell('F' + n).value = label; ws.getCell('I' + n).value = val; ws.getCell('I' + n).numFmt = NF;
    for (let c = 1; c <= 9; c++) { const cl = ws.getRow(n).getCell(c); cl.border = box; if (alt) cl.fill = fill('FFFCE4D6'); }
    ws.getCell('F' + n).font = { bold: !!big, size: big ? 12 : 11 }; ws.getCell('I' + n).font = { bold: true, size: big ? 12 : 11 };
  };
  fr(g + 1, 'TRANZIT AND COST:', t.transit, true);
  fr(g + 2, `COMMISSION (${num(o.commPct)}%):`, { formula: `ROUND(I${g}*${num(o.commPct)}/100,0)`, result: t.comm });
  fr(g + 3, 'TOTAL:', { formula: `I${g}+I${g + 1}+I${g + 2}`, result: t.final }, true, true);
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/* =============================================================
   DELIVER (save / share / print)
   ============================================================= */
function blobToB64(blob) {
  return new Promise((res, rej) => { const rd = new FileReader(); rd.onload = () => res(String(rd.result).split(',')[1]); rd.onerror = rej; rd.readAsDataURL(blob); });
}
function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
async function deliver(blob, name, mode) {
  const mime = blob.type || 'application/octet-stream';
  if (IS_APP) {
    const b64 = await blobToB64(blob);
    if (mode === 'share' || mode === 'wa') {
      const r = mode === 'wa' && window.AndroidApp.shareToWhatsApp ? window.AndroidApp.shareToWhatsApp(b64, name, mime) : window.AndroidApp.shareFile(b64, name, mime);
      if (r === 'NOWA') toast('واتساپ روی این گوشی نصب نیست — از «ارسال…» استفاده کنید');
      else if (r && r.indexOf('ERR') === 0) toast('ارسال نشد: ' + r.slice(4));
      return;
    }
    const r = window.AndroidApp.saveFile(b64, name, mime);
    if (r && r.indexOf('ERR') !== 0) toast('ذخیره شد در Downloads: ' + name, 'باز کن', () => window.AndroidApp.openFile(r, mime));
    else toast('ذخیره نشد: ' + (r || '').slice(4));
    return;
  }
  if ((mode === 'share' || mode === 'wa') && navigator.canShare) {
    const f = new File([blob], name, { type: mime });
    if (navigator.canShare({ files: [f] })) { try { await navigator.share({ files: [f], title: name }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
  }
  download(blob, name); toast('دانلود شد: ' + name);
}
function doPrint(o) {
  const html = printDoc(o);
  if (IS_APP) { window.AndroidApp.printHtml(html, baseName(o)); return; }
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(f);
  f.onload = () => { setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (e) { toast('چاپ در این مرورگر ممکن نیست'); } setTimeout(() => f.remove(), 60000); }, 300); };
  f.srcdoc = html;
}
$('oExport').onclick = () => { if (!CUR.rows.length) return toast('اول کالا اضافه کنید'); openSheet('sExport'); };
$('oXls').onclick = () => {
  if (!CUR.rows.length) return toast('اول کالا اضافه کنید');
  menu([
    { icon: '🟢', label: 'ارسال Excel در واتساپ', fn: () => runExport('xlsx-wa') },
    { icon: '↗', label: 'ارسال Excel با برنامهٔ دیگر (تلگرام، ایمیل…)', fn: () => runExport('xlsx-share') },
    { icon: '⤓', label: 'ذخیرهٔ Excel در گوشی (Downloads)', fn: () => runExport('xlsx-save') }
  ]);
};
$('oWa').onclick = () => { if (!CUR.rows.length) return toast('اول کالا اضافه کنید'); runExport('pdf-wa'); };
$('sExport').addEventListener('click', e => {
  const b = e.target.closest('[data-ex]'); if (!b) return;
  closeSheet(); runExport(b.dataset.ex);
});
async function runExport(ex) {
  const o = CUR; save(true);
  try {
    if (ex === 'print') { doPrint(o); return; }
    if (ex === 'json') {
      const blob = new Blob([JSON.stringify({ meta: o.meta, transit: o.transit, commPct: o.commPct, rows: o.rows })], { type: 'application/json' });
      return deliver(blob, baseName(o) + '.json', 'share');
    }
    const [kind, mode] = ex.split('-');
    busy(true, kind === 'pdf' ? 'در حال ساخت PDF…' : 'در حال ساخت Excel…');
    await new Promise(r => setTimeout(r, 30));
    const blob = kind === 'pdf' ? await makePdf(o) : await makeXlsx(o);
    busy(false);
    await deliver(blob, baseName(o) + (kind === 'pdf' ? '.pdf' : '.xlsx'), mode);
  } catch (err) {
    busy(false); console.error(err); toast('خطا در ساخت فایل: ' + (err && err.message || err));
  }
}

/* =============================================================
   BACK BUTTON (called by Android) + boot
   ============================================================= */
window.appBack = function () {
  if (!$('busy').hidden) return true;
  if (openSheetId) { closeSheet(); return true; }
  if (!$('vCam').hidden) { if (!$('camQuick').hidden) { $('qNext').click(); return true; } closeCam(); return true; }
  if (!$('vOrder').hidden) { goHome(); return true; }
  return false;
};
window.addEventListener('pagehide', () => save(true));

(async function boot() {
  try { await DB.open(); ORDERS = await DB.all(); }
  catch (e) { toast('حافظهٔ دائمی در دسترس نیست — اطلاعات بعد از بستن پاک می‌شود'); }
  // remove the example invoice 123 that version 1.0 added on first run (only if it was never given photos)
  const isOldSample = o => o.meta && o.meta.invNo === '123' && o.meta.cont1 === 'UNSU009384-3' && o.rows.length <= 17 && !o.rows.some(r => r.img);
  for (const o of ORDERS.filter(isOldSample)) await DB.del(o.id).catch(() => {});
  ORDERS = ORDERS.filter(o => !isOldSample(o));
  // older data may contain Persian digits typed before v1.4 — store them as English digits
  for (const o of ORDERS) {
    const before = JSON.stringify([o.meta, o.rows.map(r => [r.code, r.desc])]);
    Object.keys(o.meta).forEach(k => { if (typeof o.meta[k] === 'string') o.meta[k] = toEnDigits(o.meta[k]); });
    o.rows.forEach(r => { r.code = toEnDigits(r.code); r.desc = toEnDigits(r.desc); });
    if (JSON.stringify([o.meta, o.rows.map(r => [r.code, r.desc])]) !== before) await DB.put(o).catch(() => {});
  }
  renderHome(); showView('vHome');
})();

window.__ol = { totals, sheetPages, makeXlsx, makePdf, nextCode, get orders() { return ORDERS; } }; // for testing
})();
