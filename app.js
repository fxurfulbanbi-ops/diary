'use strict';
// ==== Налаштування ====
const OWNER = 'fxurfulbanbi-ops', REPO = 'diary-data', FILE = 'entries.json';
const LOCK_MS = 5 * 60 * 1000; // автоблокування через 5 хв бездіяльності
const LS_KEY = 'diary.token.v1';

const $ = id => document.getElementById(id);
let password = null, token = null, entries = [], sha = null, current = null, lockTimer = null;

function show(id) { for (const s of ['setup', 'unlock', 'list', 'editor']) $(s).classList.toggle('hidden', s !== id); }
const b64e = s => btoa(unescape(encodeURIComponent(s)));
const b64d = s => decodeURIComponent(escape(atob(s.replace(/\n/g, ''))));

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
  let content = f.content;
  entries = (await DiaryCrypto.decrypt(password, JSON.parse(b64d(content)))).entries || [];
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
  $('s-token').value = $('s-pass').value = $('s-pass2').value = '';
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
function opened() { renderList(); show('list'); poke(); }
function lock() {
  password = token = current = null; entries = []; sha = null; clearTimeout(lockTimer);
  $('e-text').value = $('e-title').value = ''; $('entries').innerHTML = '';
  start();
}
function poke() { if (!password) return; clearTimeout(lockTimer); lockTimer = setTimeout(lock, LOCK_MS); }
['click', 'keydown', 'touchstart', 'scroll'].forEach(ev => document.addEventListener(ev, poke, { passive: true }));
document.addEventListener('visibilitychange', () => { if (document.hidden && password) lockTimer = setTimeout(lock, 60000); });

// ==== Список та редактор ====
function renderList() {
  const q = $('l-search').value.toLowerCase(), ul = $('entries'); ul.innerHTML = '';
  const list = entries.filter(e => !q || (e.title + ' ' + e.text).toLowerCase().includes(q))
    .sort((a, b) => (b.date + b.updated).localeCompare(a.date + a.updated));
  if (!list.length) ul.innerHTML = '<p class="muted">Записів поки немає.</p>';
  for (const e of list) {
    const li = document.createElement('li'), b = document.createElement('b'), s = document.createElement('small'), p = document.createElement('div');
    s.textContent = new Date(e.date).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long', year: 'numeric' }) + ' ';
    b.textContent = e.title || '(без назви)'; p.className = 'muted'; p.textContent = e.text.slice(0, 120);
    li.append(s, b, p); li.onclick = () => edit(e); ul.append(li);
  }
}
function edit(e) {
  current = e || null;
  $('e-date').value = e ? e.date : new Date().toLocaleDateString('sv');
  $('e-title').value = e ? e.title : ''; $('e-text').value = e ? e.text : '';
  $('e-del').classList.toggle('hidden', !e); $('e-status').textContent = ''; show('editor');
}
async function withSave(fn, ok) {
  const backup = JSON.stringify(entries); $('e-status').textContent = 'Зберігаю…';
  fn();
  try { await save(); $('e-status').textContent = ok; return true; }
  catch (err) { entries = JSON.parse(backup); $('e-status').textContent = err.message; return false; }
}
$('e-save').onclick = () => withSave(() => {
  const now = new Date().toISOString(), d = { date: $('e-date').value, title: $('e-title').value.trim(), text: $('e-text').value, updated: now };
  if (current) Object.assign(entries.find(x => x.id === current.id), d);
  else { current = { id: crypto.randomUUID(), created: now, ...d }; entries.push(current); }
  $('e-del').classList.remove('hidden');
}, 'Збережено ✓');
$('e-del').onclick = async () => {
  if (!current || !confirm('Видалити цей запис назавжди?')) return;
  const id = current.id;
  if (await withSave(() => { entries = entries.filter(x => x.id !== id); }, 'Видалено')) { current = null; renderList(); show('list'); }
};
$('e-back').onclick = () => { renderList(); show('list'); };
$('l-new').onclick = () => edit(null);
$('l-lock').onclick = lock;
$('l-search').oninput = renderList;
$('s-go').onclick = setup; $('u-go').onclick = unlock;
$('u-pass').onkeydown = e => { if (e.key === 'Enter') unlock(); };
$('u-reset').onclick = () => { if (confirm('Видалити збережений токен з цього пристрою? Записи на GitHub залишаться.')) { localStorage.removeItem(LS_KEY); start(); } };

function start() { show(localStorage.getItem(LS_KEY) ? 'unlock' : 'setup'); }
start();
