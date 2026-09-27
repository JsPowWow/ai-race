// Сохранить файл: внутри Claude — через платформу, на обычном сайте — ссылкой на Blob.

const platform = typeof window.claude?.use === 'function'
  ? window.claude.use('downloads').catch(() => null)
  : Promise.resolve(undefined); // undefined — обычный сайт, скачивание ссылкой работает всегда

/** true — скачивать можно (внутри Claude это разрешает платформа) */
export const canDownload = () => platform.then((d) => d !== null);

export async function saveFile(filename, data, type = 'application/json') {
  const downloads = await platform;
  if (downloads) return downloads.save({ filename, data });
  if (downloads === null) throw new Error('скачивание недоступно');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([data], { type })),
    download: filename,
  });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Имя файла из свободного текста */
export const safeFileName = (text) => text.replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '') || 'file';
