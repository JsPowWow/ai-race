// Запечатанная сдача: файл машины, который может открыть только куратор.
//
// Как замок и ключ. Открытый ключ курса (course-key.json в репозитории) — «открытый замок»:
// защёлкнуть им файл может кто угодно. Секретный ключ — единственный ключ от этих замков,
// он хранится только у кураторов и в репозиторий не попадает.
//
// Всё на WebCrypto (crypto.subtle) — он встроен и в браузер, и в Node:
//  • для каждого файла — одноразовая пара ECDH P-256;
//  • одноразовый секрет + открытый ключ курса → общий секрет → HKDF-SHA-256 → ключ AES-GCM;
//  • AES-GCM шифрует { логин, машина, время } и заодно проверяет целостность:
//    изменённый файл просто не расшифруется.
// Каждый раз ключ новый, поэтому один и тот же файл, запечатанный дважды, выглядит по-разному —
// а два одинаковых шифротекста значат, что кто-то скопировал чужой файл целиком.

export const SEALED_FORMAT = 'ai-race/sealed@1';
export const PUBLIC_KEY_FORMAT = 'ai-race/course-key@1';
export const PRIVATE_KEY_FORMAT = 'ai-race/course-private-key@1';

/** Логин GitHub: латиница, цифры и одиночные дефисы, не с дефиса, до 39 символов */
export const GITHUB_LOGIN = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
const INFO = new TextEncoder().encode('ai-race sealed car v1');
const subtle = () => {
  if (!globalThis.crypto?.subtle) throw new Error('шифрование недоступно: откройте сайт по https или через localhost');
  return globalThis.crypto.subtle;
};

// ── base64 без Buffer: работает и в браузере, и в Node ──
const toB64 = (bytes) => {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s);
};
const fromB64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

/** Короткий отпечаток открытого ключа — чтобы понять, каким ключом запечатан файл */
async function keyId(publicJwk) {
  const hash = await subtle().digest('SHA-256', new TextEncoder().encode(`${publicJwk.x}.${publicJwk.y}`));
  return [...new Uint8Array(hash).slice(0, 6)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Оставить в ключе только нужные поля. @param {JsonWebKey} jwk */
const clean = ({ kty, crv, x, y, d }) => (d ? { kty, crv, x, y, d } : { kty, crv, x, y });

/** Новая пара ключей курса: { publicFile, privateFile } — готовые к сохранению объекты */
export async function generateCourseKeys() {
  const pair = await subtle().generateKey(ECDH, true, ['deriveBits']);
  const publicKey = clean(await subtle().exportKey('jwk', pair.publicKey));
  const privateKey = clean(await subtle().exportKey('jwk', pair.privateKey));
  const kid = await keyId(publicKey);
  const created = new Date().toISOString();
  return {
    publicFile: { format: PUBLIC_KEY_FORMAT, kid, created, publicKey },
    privateFile: { format: PRIVATE_KEY_FORMAT, kid, created, privateKey, note: 'Секретный ключ курса AI Race. Не публикуйте и не коммитьте.' },
  };
}

async function aesKey(privateKey, publicKey, salt) {
  const shared = await subtle().deriveBits({ name: 'ECDH', public: publicKey }, privateKey, 256);
  const material = await subtle().importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: INFO }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** Запечатать файл машины открытым ключом курса. login — ник на GitHub. */
export async function sealCar(car, login, publicFile) {
  if (publicFile?.format !== PUBLIC_KEY_FORMAT) throw new Error('это не открытый ключ курса');
  if (!GITHUB_LOGIN.test(login)) throw new Error('впиши свой логин на GitHub');
  const coursePublic = await subtle().importKey('jwk', publicFile.publicKey, ECDH, false, []);
  const once = await subtle().generateKey(ECDH, true, ['deriveBits']);
  const epk = clean(await subtle().exportKey('jwk', once.publicKey));
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await aesKey(once.privateKey, coursePublic, salt);
  const payload = new TextEncoder().encode(JSON.stringify({ login, car, sealedAt: new Date().toISOString() }));
  const data = await subtle().encrypt({ name: 'AES-GCM', iv }, key, payload);
  return { format: SEALED_FORMAT, kid: publicFile.kid, name: 'запечатанная машина AI Race', epk, salt: toB64(salt), iv: toB64(iv), data: toB64(data) };
}

/** Прочитать файл секретного ключа. Возвращает { kid, key } для openSealed. */
export async function importPrivateKey(privateFile) {
  if (privateFile?.format !== PRIVATE_KEY_FORMAT) throw new Error('это не секретный ключ курса AI Race');
  const key = await subtle().importKey('jwk', privateFile.privateKey, ECDH, false, ['deriveBits']);
  return { kid: privateFile.kid, key };
}

/** Открыть запечатанный файл. Возвращает { login, car, sealedAt }. Бросает Error с понятным текстом. */
export async function openSealed(sealed, { kid, key }) {
  if (sealed?.format !== SEALED_FORMAT) throw new Error('это не запечатанный файл машины');
  if (sealed.kid !== kid) throw new Error(`запечатан другим ключом курса (${sealed.kid}, а у вас ${kid}) — пусть сделает git pull и пересдаст`);
  try {
    const epk = await subtle().importKey('jwk', sealed.epk, ECDH, false, []);
    const aes = await aesKey(key, epk, fromB64(sealed.salt));
    const plain = await subtle().decrypt({ name: 'AES-GCM', iv: fromB64(sealed.iv) }, aes, fromB64(sealed.data));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new Error('файл повреждён или изменён — не расшифровывается');
  }
}
