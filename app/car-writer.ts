// Web Worker: записывает файлы гаража в OPFS — личную папку сайта в браузере.
// Почему в Worker: в старом Safari со страницы в OPFS писать нельзя, а отсюда можно всегда —
// через createSyncAccessHandle. Собирается в строку (tools/build.mjs → app/generated/car-writer.js).
// Сообщение: { id, path: ['cars', '<машина>', 'car.json'], text } → ответ { id } или { id, error }.

/** В описаниях TypeScript для страницы этого вызова нет: он есть только в Worker */
type SyncFileHandle = FileSystemFileHandle & {
  createSyncAccessHandle(): Promise<{ truncate(size: number): void; write(data: Uint8Array, at: { at: number }): number; flush(): void; close(): void }>;
};
/** Что приходит от страницы: какой файл записать */
type WriteRequest = { id: number; path: string[]; text: string };

let queue = Promise.resolve(); // пишем по одному: один и тот же файл нельзя открыть на запись дважды

async function write(path: string[], text: string): Promise<void> {
  let dir = await navigator.storage.getDirectory();
  for (const name of path.slice(0, -1)) dir = await dir.getDirectoryHandle(name, { create: true });
  const file = await dir.getFileHandle(path.at(-1) ?? 'file', { create: true });
  const access = await (file as SyncFileHandle).createSyncAccessHandle();
  try {
    const bytes = new TextEncoder().encode(text);
    access.truncate(0);
    access.write(bytes, { at: 0 });
    access.flush();
  } finally {
    access.close();
  }
}

self.onmessage = ({ data: { id, path, text } }: MessageEvent<WriteRequest>) => {
  queue = queue.then(() => write(path, text))
    .then(() => self.postMessage({ id }), (e: unknown) => self.postMessage({ id, error: e instanceof Error ? e.message : String(e) }));
};
