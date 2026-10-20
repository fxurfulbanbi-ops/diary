// Шифрування: PBKDF2-SHA256 -> AES-GCM-256 (WebCrypto). Працює в браузері та Node 20+.
(function (root) {
  const ITER = 600000;
  const C = (typeof crypto !== 'undefined') ? crypto : require('crypto').webcrypto;
  const enc = new TextEncoder(), dec = new TextDecoder();
  const b64 = u => { let s = ''; for (const b of new Uint8Array(u)) s += String.fromCharCode(b); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function deriveKey(password, salt, iter) {
    const base = await C.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
    return C.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter },
      base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function encrypt(password, obj) {
    const salt = C.getRandomValues(new Uint8Array(16)), iv = C.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt, ITER);
    const ct = await C.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(obj)));
    return { v: 1, kdf: 'PBKDF2-SHA256', iter: ITER, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
  }
  async function decrypt(password, box) {
    const key = await deriveKey(password, unb64(box.salt), box.iter);
    const pt = await C.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.ct));
    return JSON.parse(dec.decode(pt));
  }
  // Бінарні дані (фото): ключ кешується на сесію, щоб не виконувати PBKDF2 для кожного фото
  let sess = null; const kcache = new Map();
  async function keyFor(password, saltB64, iter) {
    const id = saltB64 + ':' + iter;
    if (!kcache.has(id) || kcache.get(id).pw !== password) kcache.set(id, { pw: password, key: await deriveKey(password, unb64(saltB64), iter) });
    return kcache.get(id).key;
  }
  async function encryptBytes(password, bytes) {
    if (!sess || sess.pw !== password) sess = { pw: password, salt: b64(C.getRandomValues(new Uint8Array(16))) };
    const key = await keyFor(password, sess.salt, ITER), iv = C.getRandomValues(new Uint8Array(12));
    const ct = await C.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
    return { v: 1, kdf: 'PBKDF2-SHA256', iter: ITER, salt: sess.salt, iv: b64(iv), bin: b64(ct) };
  }
  async function decryptBytes(password, box) {
    const key = await keyFor(password, box.salt, box.iter);
    return new Uint8Array(await C.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.bin)));
  }
  function clearCache() { sess = null; kcache.clear(); }
  const api = { encrypt, decrypt, encryptBytes, decryptBytes, clearCache, ITER };
  if (typeof module !== 'undefined') module.exports = api; else root.DiaryCrypto = api;
})(this);
