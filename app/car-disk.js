// Копия гаража в обычной папке на диске — её не сотрёт очистка данных браузера.
// Работает там, где есть File System Access API (Chrome, Edge); в Safari и Firefox кнопки просто нет.
//
// Папку выбирает человек (showDirectoryPicker). Доступ к ней браузер помнит через «ручку» —
// её можно положить только в IndexedDB (в localStorage не влезет: это не текст).
// После перезапуска браузер может снова спросить разрешение — это можно только по нажатию кнопки.
import { folderStore } from './car-store.js';

/** @type {any} — выбора папки нет в описаниях TypeScript: это пока только Chrome и Edge */
const win = window;
const DB = 'ai-race';
const SHELF = 'handles';
const KEY = 'garage-folder';

/** Есть ли в браузере выбор папки */
export const diskSupported = () => typeof win.showDirectoryPicker === 'function';

/** Одна маленькая база IndexedDB с одной полкой: ключ → значение */
function withShelf(mode, work) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(SHELF);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction(SHELF, mode);
      const request = work(tx.objectStore(SHELF));
      tx.oncomplete = () => { open.result.close(); resolve(request.result); };
      tx.onerror = () => { open.result.close(); reject(tx.error); };
    };
  });
}

/** Папка, выбранная раньше, или null */
export const savedFolder = () => withShelf('readonly', (shelf) => shelf.get(KEY)).then((h) => h ?? null, () => null);
const keepFolder = (handle) => withShelf('readwrite', (shelf) => shelf.put(handle, KEY));
export const forgetFolder = () => withShelf('readwrite', (shelf) => shelf.delete(KEY)).catch(() => {});

/**
 * Можно ли писать в папку: 'granted' — да, 'prompt' — надо спросить (только по нажатию), 'denied' — нет.
 * ask = true — спросить человека (вызывать только из обработчика нажатия).
 */
export async function folderAccess(handle, ask = false) {
  const options = { mode: 'readwrite' };
  const now = await handle.queryPermission?.(options) ?? 'granted';
  return now === 'prompt' && ask ? handle.requestPermission(options) : now;
}

/** Выбрать папку (только по нажатию). Бросает AbortError, если человек передумал */
export async function pickFolder() {
  const handle = await win.showDirectoryPicker({ id: 'ai-race-garage', mode: 'readwrite' });
  await keepFolder(handle);
  return handle;
}

/** Хранилище гаража в этой папке — с тем же интерфейсом, что и в app/car-store.js */
export function diskStore(root) {
  let queue = Promise.resolve(); // пишем по одному, как в Worker
  const write = (path, text) => (queue = queue.catch(() => {}).then(async () => {
    let dir = root;
    for (const name of path.slice(0, -1)) dir = await dir.getDirectoryHandle(name, { create: true });
    const file = await (await dir.getFileHandle(path.at(-1), { create: true })).createWritable();
    await file.write(text);
    await file.close();
  }));
  return folderStore('disk', root, write);
}
