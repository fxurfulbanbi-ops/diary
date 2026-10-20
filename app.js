'use strict';
// ==== Налаштування ====
const OWNER = 'fxurfulbanbi-ops', REPO = 'diary-data', FILE = 'entries.json';
const LOCK_MS = 5 * 60 * 1000; // автоблокування через 5 хв бездіяльності
const LS_KEY = 'diary.token.v1';
const MONTHS = ['Січень','Лютий','Березень','Квітень','Травень','Червень','Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'];
const MONTHS_GEN = ['січня','лютого','березня','квітня','травня','червня','липня','серпня','вересня','жовтня','листопада','грудня'];
const WD = ['неділя','понеділок','вівторок','середа','четвер','пʼятниця','субота'];

const $ = id => document.getElementById(id);
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
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
  if (!f) { entries = []; sha = null; return; }
  sha = f.sha;
  entries = (await DiaryCrypto.decrypt(password, JSON.parse(b64d(f.content)))).entries || [];
}
async function save() {
  const box = await DiaryCrypto.encrypt(password, { entries });
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
function opened() { view = new Date(); view.setDate(1); selected = todayStr(); renderCal(0); show('cal'); poke(); }
function lock() {
  password = token = current = null; entries = []; sha = null; clearTimeout(lockTimer);
  $('sheet').classList.add('hidden'); $('e-text').value = $('e-title').value = '';
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
  for (let i = 0; i < lead; i++) { const c = document.createElement('div'); c.className = 'day empty'; grid.append(c); }
  for (let d = 1; d <= days; d++) {
    const ds = `${y}-${pad(m + 1)}-${pad(d)}`, col = (lead + d - 1) % 7;
    const b = document.createElement('button');
    b.className = 'day' + (ds === today ? ' today' : '') + (ds === selected ? ' sel' : '') + (has.has(ds) ? ' has' : '') + (col > 4 ? ' wkend' : '');
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
  t.textContent = e ? e.text : 'Натисніть на день, щоб написати.';
  p.append(h, b, t); p.onclick = () => openSheet(selected);
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
  $('e-title').value = current ? current.title : ''; $('e-text').value = current ? current.text : '';
  $('e-del').classList.toggle('hidden', !current); $('e-status').textContent = '';
  const s = $('sheet'); s.classList.remove('hidden', 'closing');
  if (!current) setTimeout(() => $('e-text').focus(), reduced.matches ? 0 : 380);
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
  const title = $('e-title').value.trim(), text = $('e-text').value;
  if (!current && !title && !text.trim()) return closeSheet();
  const now = new Date().toISOString();
  const okSaved = await persist(() => {
    if (current) Object.assign(entries.find(x => x.id === current.id), { title, text, updated: now });
    else { current = { id: crypto.randomUUID(), date: editDate, created: now, title, text, updated: now }; entries.push(current); }
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
  const list = entries.filter(e => !q || ((e.title || '') + ' ' + e.text).toLowerCase().includes(q))
    .sort((a, b) => (b.date + (b.updated || '')).localeCompare(a.date + (a.updated || '')));
  if (!list.length) ul.innerHTML = '<p class="muted">Записів не знайдено.</p>';
  for (const e of list) {
    const li = document.createElement('li'), b = document.createElement('b'), s = document.createElement('small'), p = document.createElement('div');
    s.textContent = human(e.date); b.textContent = e.title || 'Без назви';
    p.className = 'muted'; p.textContent = e.text.slice(0, 120);
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

function start() { show(localStorage.getItem(LS_KEY) ? 'unlock' : 'setup'); }
start();
