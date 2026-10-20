'use strict';
// Якщо після оновлення сайту браузер змішав старі й нові файли — показуємо кнопку перезавантаження
window.addEventListener('error', () => {
  if (document.getElementById('boot-err')) return;
  const d = document.createElement('div'); d.id = 'boot-err';
  d.textContent = 'Сайт оновився. Натисніть, щоб перезавантажити.';
  d.onclick = () => location.reload();
  document.body.prepend(d);
});
// ==== Налаштування ====
const OWNER = 'fxurfulbanbi-ops', REPO = 'diary-data', FILE = 'entries.json';
const LOCK_MS = 5 * 60 * 1000; // автоблокування через 5 хв бездіяльності
const LS_KEY = 'diary.token.v1';
const MONTHS = ['Січень','Лютий','Березень','Квітень','Травень','Червень','Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'];
const MONTHS_GEN = ['січня','лютого','березня','квітня','травня','червня','липня','серпня','вересня','жовтня','листопада','грудня'];
const WD = ['неділя','понеділок','вівторок','середа','четвер','пʼятниця','субота'];

const $ = id => document.getElementById(id);
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let settings = {};
let password = null, token = null, entries = [], sha = null, current = null, lockTimer = null;
let view = new Date(); view.setDate(1);
let selected = null, editDate = null;

function show(id) { for (const s of ['setup', 'unlock', 'cal', 'list']) $(s).classList.toggle('hidden', s !== id); }
const b64e = s => btoa(unescape(encodeURIComponent(s)));
const b64d = s => decodeURIComponent(escape(atob(s.replace(/\n/g, ''))));
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = () => ymd(new Date());
const human = s => { const [y, m, d] = s.split('-').map(Number); const dt = new Date(y, m - 1, d);
  return `${WD[dt.getDay()]}, ${d} ${MONTHS_GEN[m - 1]} ${y}`; };
const learnedOf = e => e.learned ?? e.text ?? '';
// Один запис на дату (якщо в старих даних кілька — беремо останній змінений)
const byDate = d => entries.filter(e => e.date === d).sort((a, b) => (b.updated || '').localeCompare(a.updated || ''))[0];

// ==== GitHub API ====
async function gh(method, body) {
  const r = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE}`, {
    method, cache: 'no-store',
    headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    body: body ? JSON.stringify(body) : undefined });
  if (method === 'GET' && r.status === 404) return null;
  if (r.status === 401 || r.status === 403) throw new Error('GitHub відхилив токен (перевірте права або термін дії).');
  if (r.status === 409) throw new Error('Конфлікт: дані змінено на іншому пристрої. Оновіть сторінку.');
  if (!r.ok) throw new Error('Помилка GitHub: ' + r.status);
  return r.json();
}
async function load() {
  const f = await gh('GET');
  if (!f) { entries = []; settings = {}; sha = null; return; }
  sha = f.sha;
  const data = await DiaryCrypto.decrypt(password, JSON.parse(b64d(f.content)));
  entries = data.entries || []; settings = (data.settings && typeof data.settings === 'object') ? data.settings : {};
}
let saveChain = Promise.resolve();
function save() { const p = saveChain.then(saveNow); saveChain = p.catch(() => {}); return p; }
async function saveNow() {
  const box = await DiaryCrypto.encrypt(password, { entries, settings });
  const r = await gh('PUT', { message: 'update', content: b64e(JSON.stringify(box)), ...(sha ? { sha } : {}) });
  sha = r.content.sha;
}

// ==== Розблокування ====
async function setup() {
  const t = $('s-token').value.trim(), p = $('s-pass').value;
  if (!t || p.length < 8) return $('s-msg').textContent = 'Введіть токен і пароль (мін. 8 символів).';
  if (p !== $('s-pass2').value) return $('s-msg').textContent = 'Паролі не збігаються.';
  $('s-msg').textContent = 'Перевіряю…';
  token = t; password = p;
  try { await load(); } catch (e) {
    token = password = null;
    return $('s-msg').textContent = e.name === 'OperationError' ? 'Цей пароль не підходить до наявних записів.' : e.message;
  }
  localStorage.setItem(LS_KEY, JSON.stringify(await DiaryCrypto.encrypt(p, { token: t })));
  $('s-token').value = $('s-pass').value = $('s-pass2').value = ''; $('s-msg').textContent = '';
  opened();
}
async function unlock() {
  const p = $('u-pass').value; $('u-msg').textContent = 'Відкриваю…';
  try { token = (await DiaryCrypto.decrypt(p, JSON.parse(localStorage.getItem(LS_KEY)))).token; }
  catch { return $('u-msg').textContent = 'Невірний пароль.'; }
  password = p;
  try { await load(); } catch (e) { lock(); return $('u-msg').textContent = e.name === 'OperationError' ? 'Не вдалося розшифрувати записи.' : e.message; }
  $('u-pass').value = ''; $('u-msg').textContent = ''; opened();
}
function opened() { view = new Date(); view.setDate(1); selected = todayStr(); renderCal(0); show('cal'); poke(); autoProfit(); }
function lock() {
  password = token = current = null; entries = []; settings = {}; sha = null; clearTimeout(lockTimer);
  $('sheet').classList.add('hidden'); pnlReset(); $('e-learned').value = $('e-improve').value = $('e-notes').value = $('e-title').value = '';
  $('entries').innerHTML = ''; $('c-grid').innerHTML = ''; $('c-preview').innerHTML = '';
  start();
}
function poke() { if (!password) return; clearTimeout(lockTimer); lockTimer = setTimeout(lock, LOCK_MS); }
['click', 'keydown', 'touchstart', 'scroll'].forEach(ev => document.addEventListener(ev, poke, { passive: true }));
document.addEventListener('visibilitychange', () => { if (document.hidden && password) { clearTimeout(lockTimer); lockTimer = setTimeout(lock, 60000); } });

// ==== Календар ====
function renderCal(dir) {
  const y = view.getFullYear(), m = view.getMonth();
  const t = $('c-title'); t.textContent = '';
  const s = document.createElement('span'); s.textContent = MONTHS[m]; t.append(s, ' ' + y);
  const grid = $('c-grid'); grid.innerHTML = '';
  const lead = (new Date(y, m, 1).getDay() + 6) % 7; // тиждень з понеділка
  const days = new Date(y, m + 1, 0).getDate(), today = todayStr();
  const has = new Set(entries.map(e => e.date));
  const pnlOf = new Map(entries.filter(e => typeof e.profit === 'number').map(e => [e.date, e.profit]));
  for (let i = 0; i < lead; i++) { const c = document.createElement('div'); c.className = 'day empty'; grid.append(c); }
  for (let d = 1; d <= days; d++) {
    const ds = `${y}-${pad(m + 1)}-${pad(d)}`, col = (lead + d - 1) % 7;
    const b = document.createElement('button');
    b.className = 'day' + (ds === today ? ' today' : '') + (ds === selected ? ' sel' : '') + (has.has(ds) ? ' has' : '') + (pnlOf.get(ds) > 0 ? ' up' : pnlOf.get(ds) < 0 ? ' down' : '') + (col > 4 ? ' wkend' : '');
    b.setAttribute('aria-label', human(ds) + (has.has(ds) ? ', є запис' : ''));
    const n = document.createElement('span'); n.className = 'n'; n.textContent = d;
    const dot = document.createElement('span'); dot.className = 'dot';
    b.append(n, dot);
    b.onclick = () => { selected = ds; grid.querySelectorAll('.sel').forEach(x => x.classList.remove('sel')); b.classList.add('sel'); preview(); openSheet(ds); };
    grid.append(b);
  }
  preview();
  if (dir && !reduced.matches && grid.animate)
    grid.animate([{ transform: `translateX(${dir * 40}%)`, opacity: 0 }, { transform: 'none', opacity: 1 }],
      { duration: 320, easing: 'cubic-bezier(.2,.9,.3,1)' });
}
function preview() {
  const p = $('c-preview'); p.innerHTML = '';
  if (!selected) return;
  const e = byDate(selected), h = document.createElement('small'), b = document.createElement('b'), t = document.createElement('p');
  h.className = 'muted'; h.textContent = human(selected);
  b.textContent = e ? (e.title || 'Без назви') : 'Немає запису';
  t.textContent = e ? '' : 'Натисніть на день, щоб написати.';
  if (e) for (const [q, v] of [['What did i learn today?', learnedOf(e)], ['What can i improve tomorrow?', e.improve || ''], ['OTHER NOTES', e.notes || '']]) {
    if (!v.trim()) continue;
    const l = document.createElement('span'); l.className = 'prevq'; l.textContent = q;
    t.append(l, v.length > 140 ? v.slice(0, 140) + '…' : v);
  }
  p.append(h, b, t); if (e) { const bd = badges(e); if (bd) p.append(bd); }
  p.onclick = () => openSheet(selected);
}
function shift(n) { view = new Date(view.getFullYear(), view.getMonth() + n, 1); renderCal(n); }
$('c-prev').onclick = () => shift(-1);
$('c-next').onclick = () => shift(1);
$('c-today').onclick = () => { const now = new Date(); const n = (now.getFullYear() - view.getFullYear()) * 12 + now.getMonth() - view.getMonth();
  selected = todayStr(); view = new Date(now.getFullYear(), now.getMonth(), 1); renderCal(Math.sign(n)); };
let tx = null, ty = 0;
$('c-viewport').addEventListener('touchstart', e => { tx = e.touches[0].clientX; ty = e.touches[0].clientY; }, { passive: true });
$('c-viewport').addEventListener('touchend', e => {
  if (tx === null) return;
  const dx = e.changedTouches[0].clientX - tx, dy = e.changedTouches[0].clientY - ty; tx = null;
  if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) shift(dx < 0 ? 1 : -1);
}, { passive: true });
document.addEventListener('keydown', e => {
  if ($('cal').classList.contains('hidden') || !$('sheet').classList.contains('hidden')) return;
  if (e.key === 'ArrowLeft') shift(-1); if (e.key === 'ArrowRight') shift(1);
});

// ==== Лист-редактор (як в iOS) ====
function openSheet(ds) {
  editDate = ds; current = byDate(ds) || null;
  $('e-date').textContent = human(ds).replace(/^\S+, /, '');
  $('e-title').value = current ? current.title : ''; $('e-learned').value = current ? learnedOf(current) : ''; $('e-improve').value = current ? (current.improve || '') : ''; $('e-notes').value = current ? (current.notes || '') : '';
  fillFields(current); $('e-del').classList.toggle('hidden', !current); $('e-status').textContent = '';
  const s = $('sheet'); s.classList.remove('hidden', 'closing');
  if (ds === todayStr()) autoProfit();
  if (!current) setTimeout(() => $('e-learned').focus(), reduced.matches ? 0 : 380);
}
function closeSheet() {
  const s = $('sheet'); if (s.classList.contains('hidden')) return;
  if (reduced.matches) return s.classList.add('hidden');
  s.classList.add('closing');
  setTimeout(() => s.classList.add('hidden'), 280);
}
async function persist(fn, ok) {
  const backup = JSON.stringify(entries); $('e-status').textContent = 'Зберігаю…';
  fn();
  try { await save(); $('e-status').textContent = ok; return true; }
  catch (err) { entries = JSON.parse(backup); $('e-status').textContent = err.message; return false; }
}
$('e-save').onclick = async () => {
  if (!current) current = byDate(editDate) || null;
  const title = $('e-title').value.trim(), learned = $('e-learned').value, improve = $('e-improve').value, notes = $('e-notes').value, f = readFields();
  if (!current && !title && !learned.trim() && !improve.trim() && !notes.trim() && !Object.keys(f).length) return closeSheet();
  const now = new Date().toISOString();
  const okSaved = await persist(() => {
    const e = current ? entries.find(x => x.id === current.id) : { id: crypto.randomUUID(), date: editDate, created: now };
    for (const k of FIELD_KEYS) delete e[k];
    delete e.text; // старий текст перенесено в learned
    Object.assign(e, { title, learned, improve, notes, updated: now }, f);
    if (!entries.includes(e)) entries.push(e);
    current = e;
  }, 'Збережено ✓');
  if (okSaved) { renderCal(0); renderList(); closeSheet(); }
};
$('e-del').onclick = async () => {
  if (!current || !confirm('Видалити цей запис назавжди?')) return;
  const id = current.id;
  if (await persist(() => { entries = entries.filter(x => x.id !== id); }, 'Видалено')) { current = null; renderCal(0); renderList(); closeSheet(); }
};
$('e-cancel').onclick = closeSheet; $('sh-backdrop').onclick = closeSheet;
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });

// ==== Список / пошук ====
function renderList() {
  const q = $('l-search').value.toLowerCase(), ul = $('entries'); ul.innerHTML = '';
  const list = entries.filter(e => !q || [e.title, learnedOf(e), e.improve, e.notes].join(' ').toLowerCase().includes(q))
    .sort((a, b) => (b.date + (b.updated || '')).localeCompare(a.date + (a.updated || '')));
  if (!list.length) ul.innerHTML = '<p class="muted">Записів не знайдено.</p>';
  for (const e of list) {
    const li = document.createElement('li'), b = document.createElement('b'), s = document.createElement('small'), p = document.createElement('div');
    s.textContent = human(e.date); b.textContent = e.title || 'Без назви';
    p.className = 'muted'; p.textContent = [learnedOf(e), e.improve, e.notes].filter(Boolean).join(' · ').slice(0, 120);
    li.append(s, b, p);
    li.onclick = () => { const [y, m] = e.date.split('-').map(Number); view = new Date(y, m - 1, 1); selected = e.date;
      renderCal(0); show('cal'); openSheet(e.date); };
    ul.append(li);
  }
}
$('c-list').onclick = () => { renderList(); show('list'); };
$('l-back').onclick = () => show('cal');
$('c-lock').onclick = lock;
$('l-search').oninput = renderList;
$('s-go').onclick = setup; $('u-go').onclick = unlock;
$('u-pass').onkeydown = e => { if (e.key === 'Enter') unlock(); };
$('u-reset').onclick = () => { if (confirm('Видалити збережений токен з цього пристрою? Записи на GitHub залишаться.')) { localStorage.removeItem(LS_KEY); start(); } };

// ==== Прибуток за 24 год (Birdeye) ====
const BE_KEY = 'diary.birdeye.v1';
const WALLETS = ['GR7Jcg1NLz9JGWYJoap9gNqJLeLvZtKbaHjuk1ryz5Tk', '4euC2CXnrRcTFw4PEYrGvYUr2pd4vD9aqVrvJwYtPXmf'];
let beKey = null, pnlBusy = false;
const short = a => a.slice(0, 4) + '…' + a.slice(-4);
const usd = n => (n > 0 ? '+' : n < 0 ? '−' : '') + '$' + Math.abs(n).toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cls = n => n > 0 ? 'pos' : n < 0 ? 'neg' : '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
function pnlReset() { beKey = null; $('p-keyform').classList.add('hidden'); $('p-keyinput').value = '';
  $('p-body').innerHTML = '<p class="muted">Натисніть ↻, щоб завантажити.</p>'; }
function pnlMsg(t) { const p = document.createElement('p'); p.className = 'msg'; p.textContent = t; $('p-body').replaceChildren(p); }
async function getKey() {
  if (beKey) return beKey;
  if (!password) return null;
  // 1) ключ із зашифрованих даних (синхронізується між пристроями)
  if (settings.birdeyeKey) { beKey = settings.birdeyeKey; cacheKeyLocally(beKey); return beKey; }
  // 2) старий локальний ключ -> переносимо в дані
  const raw = localStorage.getItem(BE_KEY); if (!raw) return null;
  const pw = password;
  try { beKey = (await DiaryCrypto.decrypt(pw, JSON.parse(raw))).key; }
  catch { return null; } // НЕ видаляємо: могло бути блокування під час розшифрування
  if (password !== pw) { beKey = null; return null; }
  settings.birdeyeKey = beKey;
  save().catch(() => { /* збережеться разом із наступним записом */ });
  return beKey;
}
async function cacheKeyLocally(k) {
  try { const pw = password; const box = await DiaryCrypto.encrypt(pw, { key: k }); if (password === pw) localStorage.setItem(BE_KEY, JSON.stringify(box)); } catch {}
}
function showKeyForm() { $('p-keyform').classList.remove('hidden'); $('p-keyforget').classList.toggle('hidden', !(settings.birdeyeKey || localStorage.getItem(BE_KEY))); $('p-keyinput').focus(); }
$('p-key').onclick = () => $('p-keyform').classList.contains('hidden') ? showKeyForm() : $('p-keyform').classList.add('hidden');
$('p-keysave').onclick = async () => {
  const k = $('p-keyinput').value.trim(); if (!k || !password) return;
  beKey = k; settings.birdeyeKey = k;
  $('p-keysave').disabled = true;
  try { await Promise.all([cacheKeyLocally(k), save()]); }
  catch (e) { pnlMsg('Ключ збережено на цьому пристрої, але не синхронізовано: ' + e.message); }
  finally { $('p-keysave').disabled = false; } $('p-keyinput').value = ''; $('p-keyform').classList.add('hidden'); loadPnl();
};
$('p-keyforget').onclick = () => { if (!confirm('Видалити ключ Birdeye з цього пристрою?')) return;
  localStorage.removeItem(BE_KEY); beKey = null; delete settings.birdeyeKey; save().catch(e => pnlMsg(e.message)); $('p-keyform').classList.add('hidden'); pnlReset(); };
$('p-refresh').onclick = () => loadPnl();
// Шукаємо поле pnl у відповіді незалежно від точної вкладеності
function findPnl(o, depth = 0) {
  if (!o || typeof o !== 'object' || depth > 5) return null;
  if ('realized_profit_usd' in o || 'unrealized_usd' in o || 'total_usd' in o) return o;
  for (const v of Object.values(o)) { const r = findPnl(v, depth + 1); if (r) return r; }
  return null;
}
const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
async function fetchPnl(wallet, key) {
  const url = `https://public-api.birdeye.so/wallet/v2/pnl/summary?wallet=${wallet}&duration=24h`;
  let r;
  try { r = await fetch(url, { headers: { 'x-api-key': key, 'x-chain': 'solana', accept: 'application/json' }, cache: 'no-store' }); }
  catch { throw new Error('Немає звʼязку з Birdeye. Перевірте інтернет.'); }
  if (r.status === 401 || r.status === 403) { const e = new Error('Невірний або неактивний ключ Birdeye (або тариф не дає доступу).'); e.badKey = true; throw e; }
  if (r.status === 429) throw new Error('Забагато запитів до Birdeye. Спробуйте за хвилину.');
  if (!r.ok) throw new Error('Помилка Birdeye: ' + r.status);
  let j; try { j = await r.json(); } catch { throw new Error('Birdeye повернув незрозумілу відповідь.'); }
  if (j && j.success === false) throw new Error('Birdeye: ' + (j.message || 'помилка'));
  const p = findPnl(j && j.data !== undefined ? j.data : j);
  if (!p) throw new Error('Не вдалося знайти дані PnL у відповіді.');
  const realized = num(p.realized_profit_usd), unrealized = num(p.unrealized_usd);
  return { realized, unrealized, total: p.total_usd != null ? num(p.total_usd) : realized + unrealized };
}
function pnlRow(label, d, total) {
  const row = document.createElement('div'); row.className = 'prow' + (total ? ' total' : '');
  const a = document.createElement('span'); a.className = 'addr'; a.textContent = label;
  const t = document.createElement('span'); t.className = 'tot ' + cls(d.total); t.textContent = usd(d.total);
  const s = document.createElement('span'); s.className = 'sub';
  const r1 = document.createElement('span'); r1.className = cls(d.realized); r1.textContent = usd(d.realized);
  const r2 = document.createElement('span'); r2.className = cls(d.unrealized); r2.textContent = usd(d.unrealized);
  s.append('Реалізовано ', r1, ' · Нереалізовано ', r2);
  row.append(a, t, s); return row;
}
async function loadPnl() {
  if (pnlBusy || !password) return;
  const key = await getKey();
  if (!key) return showKeyForm();
  pnlBusy = true; const sp = document.createElement('div'); sp.className = 'spinner'; $('p-body').replaceChildren(sp);
  try {
    const res = [];
    for (let i = 0; i < WALLETS.length; i++) { if (i) await sleep(1100); res.push(await fetchPnl(WALLETS[i], key)); }
    if (!password) return;
    const sum = res.reduce((a, d) => ({ realized: a.realized + d.realized, unrealized: a.unrealized + d.unrealized, total: a.total + d.total }), { realized: 0, unrealized: 0, total: 0 });
    const frag = document.createDocumentFragment();
    res.forEach((d, i) => frag.append(pnlRow(short(WALLETS[i]), d)));
    frag.append(pnlRow('Разом', sum, true)); storeTodayProfit(sum.total);
    const upd = document.createElement('p'); upd.className = 'muted'; upd.textContent = 'Оновлено о ' + new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
    frag.append(upd); $('p-body').replaceChildren(frag);
  } catch (e) { if (password) { pnlMsg(e.message); if (e.badKey) { beKey = null; showKeyForm(); } } }
  finally { pnlBusy = false; }
}

// ==== Поля дня: прибуток, кроки, настрій, спортзал ====
const FIELD_KEYS = ['profit', 'steps', 'mood', 'moodScore', 'moodNote', 'gym', 'gymNote'];
const moodEmoji = n => n >= 9 ? '😄' : n >= 7 ? '🙂' : n >= 5 ? '😐' : n >= 3 ? '😔' : '😣';
let moodSel = null, legacyMood = null;
// ==== Колесо вибору настрою (як у iOS) ====
const mbtn = $('f-mood-btn'), wlist = $('w-list'), wheel = $('wheel'), ITEM_H = 44;
for (let n = 1; n <= 10; n++) {
  const d = document.createElement('div'); d.className = 'witem'; d.dataset.n = n; d.textContent = moodEmoji(n) + '  ' + n;
  d.onclick = () => { if (wheelIdx() === n - 1) return wheelDone(); wlist.scrollTo({ top: (n - 1) * ITEM_H, behavior: reduced.matches ? 'auto' : 'smooth' }); };
  wlist.append(d);
}
const wheelIdx = () => Math.max(0, Math.min(9, Math.round(wlist.scrollTop / ITEM_H)));
let wheelRaf = 0;
function paintWheel() {
  wheelRaf = 0;
  const mid = wlist.scrollTop / ITEM_H, ci = wheelIdx();
  for (const it of wlist.children) {
    const d = (+it.dataset.n - 1) - mid, ad = Math.min(Math.abs(d), 3);
    it.style.transform = `rotateX(${(-d * 22).toFixed(1)}deg) scale(${(1 - ad * 0.08).toFixed(3)})`;
    it.style.opacity = (1 - ad * 0.28).toFixed(2);
    it.classList.toggle('center', +it.dataset.n - 1 === ci);
  }
}
wlist.addEventListener('scroll', () => { if (!wheelRaf) wheelRaf = requestAnimationFrame(paintWheel); }, { passive: true });
wlist.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); wlist.scrollTo({ top: (wheelIdx() + (e.key === 'ArrowDown' ? 1 : -1)) * ITEM_H, behavior: 'smooth' }); }
  if (e.key === 'Enter') wheelDone();
});
function openWheel() {
  wheel.classList.remove('hidden', 'closing');
  wlist.scrollTop = ((moodSel || 5) - 1) * ITEM_H; paintWheel(); wlist.focus({ preventScroll: true });
}
function closeWheel() {
  if (wheel.classList.contains('hidden')) return;
  if (reduced.matches) return wheel.classList.add('hidden');
  wheel.classList.add('closing'); setTimeout(() => wheel.classList.add('hidden'), 300);
}
function wheelDone() { moodSel = wheelIdx() + 1; paintMoods(); closeWheel(); }
mbtn.onclick = ev => { ev.stopPropagation(); openWheel(); };
$('w-done').onclick = wheelDone;
$('w-clear').onclick = () => { moodSel = null; paintMoods(); closeWheel(); };
$('w-backdrop').onclick = closeWheel;
document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeWheel(); });
function toggleMenu() { closeWheel(); }
function paintMoods() {
  mbtn.textContent = moodSel ? moodEmoji(moodSel) + ' ' + moodSel + '/10' : (legacyMood || '—');
}
function fillFields(e) {
  e = e || {};
  $('f-profit').value = e.profit ?? ''; tintProfit(); $('f-steps').value = e.steps ?? ''; tintSteps();
  moodSel = Number.isInteger(e.moodScore) ? e.moodScore : null; legacyMood = e.mood || null; toggleMenu(false); paintMoods(); $('f-mood-note').value = e.moodNote || '';
  $('f-gym').checked = !!e.gym; $('f-gym-note').value = e.gymNote || ''; $('f-gym-note').classList.toggle('hidden', !e.gym);
  const today = editDate === todayStr();
  $('f-profit-fetch').classList.toggle('hidden', !today);
  $('f-profit-hint').textContent = today ? (e.profitAt ? 'Оновлено автоматично о ' + new Date(e.profitAt).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }) + '.' : '') : 'Для минулих днів введіть вручну (безкоштовний Birdeye дає лише останні 24 год).';
}
$('f-gym').onchange = () => $('f-gym-note').classList.toggle('hidden', !$('f-gym').checked);
function tintProfit() {
  const v = parseFloat($('f-profit').value), row = $('f-profit-row');
  row.classList.toggle('up', v > 0); row.classList.toggle('down', v < 0);
}
$('f-profit').addEventListener('input', tintProfit);
const STEPS_GOAL = 15000;
function tintSteps() {
  const raw = $('f-steps').value.trim(), v = parseInt(raw, 10), row = $('f-steps-row');
  const ok = raw !== '' && Number.isFinite(v);
  row.classList.toggle('up', ok && v >= STEPS_GOAL); row.classList.toggle('down', ok && v < STEPS_GOAL);
}
$('f-steps').addEventListener('input', tintSteps);
function readFields() {
  const f = {}, pr = parseFloat($('f-profit').value), st = parseInt($('f-steps').value, 10);
  if (Number.isFinite(pr)) f.profit = Math.round(pr * 100) / 100;
  if (Number.isFinite(st) && st >= 0) f.steps = st;
  if (moodSel) f.moodScore = moodSel; else if (legacyMood) f.mood = legacyMood;
  const mn = $('f-mood-note').value.trim(); if (mn) f.moodNote = mn;
  if ($('f-gym').checked) { f.gym = true; const gn = $('f-gym-note').value.trim(); if (gn) f.gymNote = gn; }
  return f;
}
$('f-profit-fetch').onclick = () => autoProfit(true);
// Автоматичний прибуток за сьогодні: сума 24h по обох гаманцях, зберігається в зашифрований запис.
const PROFIT_TTL = 10 * 60 * 1000;
let profitJob = null, profitFailAt = 0;
function hint(t) { if (editDate === todayStr() && !$('sheet').classList.contains('hidden')) $('f-profit-hint').textContent = t; }
async function autoProfit(force) {
  if (!password || profitJob) return profitJob;
  const d = todayStr(), e0 = byDate(d);
  if (!force && e0 && e0.profitAt && Date.now() - Date.parse(e0.profitAt) < PROFIT_TTL) return;
  if (!force && Date.now() - profitFailAt < PROFIT_TTL) return;
  profitJob = (async () => {
    const key = await getKey();
    if (!key) { hint('Додайте ключ Birdeye у картці «Прибуток за 24 год» — тоді прибуток заповнюватиметься сам.'); return; }
    hint('Завантажую прибуток з Birdeye…'); $('f-profit-fetch').disabled = true;
    let sum = 0;
    try { for (let i = 0; i < WALLETS.length; i++) { if (i) await sleep(1100); sum += (await fetchPnl(WALLETS[i], key)).total; } }
    catch (err) { profitFailAt = Date.now(); hint(err.message); return; }
    await storeTodayProfit(sum);
  })().finally(() => { profitJob = null; $('f-profit-fetch').disabled = false; });
  return profitJob;
}
async function storeTodayProfit(sum) {
  if (!password) return;
  const d = todayStr(), now = new Date().toISOString(), val = Math.round(sum * 100) / 100;
  const backup = JSON.stringify(entries);
  let e = byDate(d);
  if (!e) { e = { id: crypto.randomUUID(), date: d, created: now, title: '', learned: '', improve: '', notes: '', updated: now }; entries.push(e); }
  Object.assign(e, { profit: val, profitAt: now });
  if (editDate === d && !$('sheet').classList.contains('hidden')) { $('f-profit').value = val.toFixed(2); tintProfit(); if (!current) current = e; }
  try { await save(); hint('Оновлено автоматично о ' + new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' }) + ' (24 год, обидва гаманці).'); }
  catch (err) { entries = JSON.parse(backup); if (current && !entries.find(x => x.id === current.id)) current = null; hint(err.message); return; }
  if (!$('cal').classList.contains('hidden')) renderCal(0);
}
function badges(e) {
  const out = [];
  if (e.profit != null) out.push([usd(e.profit), cls(e.profit)]);
  if (e.steps != null) out.push(['👣 ' + e.steps.toLocaleString('uk-UA'), e.steps >= STEPS_GOAL ? 'pos' : 'neg']);
  const mf = Number.isInteger(e.moodScore) ? moodEmoji(e.moodScore) + ' ' + e.moodScore + '/10' : e.mood;
  if (mf || e.moodNote) out.push([(mf || '🙂') + (e.moodNote ? ' ' + e.moodNote.slice(0, 30) : ''), '']);
  if (e.gym) out.push(['🏋️ ' + (e.gymNote ? e.gymNote.slice(0, 30) : 'Зал'), '']);
  if (!out.length) return null;
  const d = document.createElement('div'); d.className = 'badges';
  for (const [t, c] of out) { const s = document.createElement('span'); s.className = 'badge ' + c; s.textContent = t; d.append(s); }
  return d;
}

function start() { show(localStorage.getItem(LS_KEY) ? 'unlock' : 'setup'); }
start();
