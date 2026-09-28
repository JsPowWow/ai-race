// Web Worker: записывает файлы гаража в OPFS — личную папку сайта в браузере.
// Почему в Worker: в старом Safari со страницы в OPFS писать нельзя, а отсюда можно всегда —
// через createSyncAccessHandle. Собирается в строку (tools/build.mjs → app/generated/car-writer.js).
// Сообщение: { id, path: ['cars', '<машина>', 'car.json'], text } → ответ { id } или { id, error }.

let queue = Promise.resolve(); // пишем по одному: один и тот же файл нельзя открыть на запись дважды

async function write(path, text) {
  let dir = await navigator.storage.getDirectory();
  for (const name of path.slice(0, -1)) dir = await dir.getDirectoryHandle(name, { create: true });
  const file = await dir.getFileHandle(path.at(-1), { create: true });
  const access = await /** @type {any} */ (file).createSyncAccessHandle(); // в описаниях TypeScript для страницы этого вызова нет — он только в Worker
  try {
    const bytes = new TextEncoder().encode(text);
    access.truncate(0);
    access.write(bytes, { at: 0 });
    access.flush();
  } finally {
    access.close();
  }
}

self.onmessage = ({ data: { id, path, text } }) => {
  queue = queue.then(() => write(path, text))
    .then(() => self.postMessage({ id }), (e) => self.postMessage({ id, error: String(e?.message ?? e) }));
};
