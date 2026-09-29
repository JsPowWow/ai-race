// Где лежат машины гаража. Каждая машина — папка cars/<id>/ с файлами car.json, history.json и runs.json.
//
// Два места, у обоих одни и те же вызовы — остальной код не знает, какое сейчас:
//  • 'opfs'  — личная папка сайта в браузере (navigator.storage.getDirectory): места много, другие сайты её не видят.
//              Пишем через Web Worker (app/car-writer.ts) — так работает и в старом Safari;
//  • 'local' — localStorage, если папки нет (старый браузер, приватное окно, файл открыт с диска): места ~5 МБ.
//
import { WRITER_SOURCE } from './generated/car-writer.js';
import { load, save, remove as forget } from './storage.ts';

/** Где лежат машины: у всех мест одни и те же вызовы */
export type CarStore = {
  kind: 'opfs' | 'local' | 'disk';
  /** id всех машин */
  list(): Promise<string[]>;
  /** Текст файла машины или null, если его нет */
  read(id: string, file: string): Promise<string | null>;
  /** Размер файла в байтах (0, если его нет) */
  size(id: string, file: string): Promise<number>;
  write(id: string, file: string, text: string): Promise<void>;
  /** Удалить машину со всеми её файлами */
  remove(id: string): Promise<void>;
};
/** Записать текст в файл по пути ['cars', id, 'car.json'] */
export type WriteFile = (path: string[], text: string) => Promise<void>;

/** Папка на диске — её перебор по записям пока есть не во всех описаниях TypeScript */
type Folder = FileSystemDirectoryHandle & { entries(): AsyncIterable<[string, FileSystemHandle]> };

const bytes = (text: string): number => new Blob([text]).size;

/** Хранилище в папке (FileSystemDirectoryHandle): читаем со страницы, пишем через writeFile */
export function folderStore(kind: CarStore['kind'], root: FileSystemDirectoryHandle, writeFile: WriteFile): CarStore {
  const cars = () => root.getDirectoryHandle('cars', { create: true }) as Promise<Folder>;
  const file = async (id: string, name: string) => {
    try {
      return await (await (await cars()).getDirectoryHandle(id)).getFileHandle(name);
    } catch {
      return null; // нет такой машины или файла
    }
  };
  return {
    kind,
    async list() {
      const ids: string[] = [];
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
function workerWriter(): WriteFile {
  const worker = new Worker(URL.createObjectURL(new Blob([WRITER_SOURCE], { type: 'text/javascript' })));
  const waiting = new Map<number, { resolve: () => void; reject: (e: Error) => void }>();
  let next = 0;
  worker.onmessage = ({ data: { id, error } }: MessageEvent<{ id: number; error?: string }>) => {
    const done = waiting.get(id);
    waiting.delete(id);
    if (error) done?.reject(new Error(error));
    else done?.resolve();
  };
  return (path, text) => new Promise<void>((resolve, reject) => {
    const id = ++next;
    waiting.set(id, { resolve, reject });
    worker.postMessage({ id, path, text });
  });
}

/** Запасное место — localStorage: ключи car:<id>:<файл>, список машин отдельно */
function localStore(): CarStore {
  const key = (id: string, name: string) => `car:${id}:${name}`;
  const ids = () => load<string[]>('cars', []);
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
      for (const name of ['car.json', 'history.json', 'runs.json']) forget(key(id, name));
      save('cars', ids().filter((x) => x !== id));
    },
  };
}

/** Открыть хранилище гаража: OPFS, если браузер его даёт, иначе localStorage */
export async function openCarStore(): Promise<CarStore> {
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
