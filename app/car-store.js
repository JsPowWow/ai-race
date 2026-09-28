// Где лежат машины гаража. Каждая машина — папка cars/<id>/ с двумя файлами: car.json и history.json.
//
// Два места, у обоих одни и те же вызовы — остальной код не знает, какое сейчас:
//  • 'opfs'  — личная папка сайта в браузере (navigator.storage.getDirectory): места много, другие сайты её не видят.
//              Пишем через Web Worker (app/car-writer.js) — так работает и в старом Safari;
//  • 'local' — localStorage, если папки нет (старый браузер, приватное окно, файл открыт с диска): места ~5 МБ.
//
// Интерфейс: { kind, list(), read(id, file), size(id, file), write(id, file, text), remove(id) }.
// read → текст или null, size → байты (0, если файла нет).
import { WRITER_SOURCE } from './generated/car-writer.js';
import { load, save, remove as forget } from './storage.js';

const bytes = (text) => new Blob([text]).size;

/** Хранилище в папке (FileSystemDirectoryHandle): читаем со страницы, пишем через writeFile */
export function folderStore(kind, root, writeFile) {
  const cars = () => root.getDirectoryHandle('cars', { create: true });
  const file = async (id, name) => {
    try {
      return await (await (await cars()).getDirectoryHandle(id)).getFileHandle(name);
    } catch {
      return null; // нет такой машины или файла
    }
  };
  return {
    kind,
    async list() {
      const ids = [];
      for await (const [name, handle] of (await cars()).entries()) if (handle.kind === 'directory') ids.push(name);
      return ids;
    },
    async read(id, name) {
      const handle = await file(id, name);
      return handle ? (await handle.getFile()).text() : null;
    },
    async size(id, name) {
      const handle = await file(id, name);
      return handle ? (await handle.getFile()).size : 0;
    },
    write: (id, name, text) => writeFile(['cars', id, name], text),
    async remove(id) {
      await (await cars()).removeEntry(id, { recursive: true }).catch(() => {});
    },
  };
}

/** Запись в OPFS через Worker: ждём ответа на каждый файл */
function workerWriter() {
  const worker = new Worker(URL.createObjectURL(new Blob([WRITER_SOURCE], { type: 'text/javascript' })));
  const waiting = new Map();
  let next = 0;
  worker.onmessage = ({ data: { id, error } }) => {
    const done = waiting.get(id);
    waiting.delete(id);
    if (error) done?.reject(new Error(error));
    else done?.resolve();
  };
  return (path, text) => new Promise((resolve, reject) => {
    const id = ++next;
    waiting.set(id, { resolve, reject });
    worker.postMessage({ id, path, text });
  });
}

/** Запасное место — localStorage: ключи car:<id>:<файл>, список машин отдельно */
function localStore() {
  const key = (id, name) => `car:${id}:${name}`;
  const ids = () => load('cars', []);
  return {
    kind: 'local',
    list: async () => ids(),
    read: async (id, name) => {
      const value = load(key(id, name), null);
      return value === null ? null : JSON.stringify(value);
    },
    size: async (id, name) => {
      const value = load(key(id, name), null);
      return value === null ? 0 : bytes(JSON.stringify(value));
    },
    async write(id, name, text) {
      if (!save(key(id, name), JSON.parse(text))) throw new Error('не хватило места в браузере');
      if (!ids().includes(id)) save('cars', [...ids(), id]);
    },
    async remove(id) {
      for (const name of ['car.json', 'history.json']) forget(key(id, name));
      save('cars', ids().filter((x) => x !== id));
    },
  };
}

/** Открыть хранилище гаража: OPFS, если браузер его даёт, иначе localStorage */
export async function openCarStore() {
  try {
    const root = await navigator.storage.getDirectory();
    const write = workerWriter();
    await write(['probe.txt'], 'ok'); // проверка: папка правда пишется (в приватном окне или без Worker — нет)
    return folderStore('opfs', root, write);
  } catch {
    return localStore();
  }
}

export { bytes };
