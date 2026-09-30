// Сохранить файл: внутри Claude — через платформу, на обычном сайте — ссылкой на Blob.
import { isSomeFunction } from '@reely/basics';
import { slugify } from '@reely/strings';

const platform = isSomeFunction(window.claude?.use)
  ? window.claude.use('downloads').catch(() => null)
  : Promise.resolve(undefined); // undefined — обычный сайт, скачивание ссылкой работает всегда

/** true — скачивать можно (внутри Claude это разрешает платформа) */
export const canDownload = () => platform.then((d) => d !== null);

export async function saveFile(filename: string, data: string, type = 'application/json'): Promise<void> {
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

/** Имя файла из свободного текста: «Моя Машина №1» → «моя-машина-1»; одни значки — просто «file» */
export const safeFileName = (text: string): string => slugify(text) || 'file';
