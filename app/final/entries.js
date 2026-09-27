// Работы участников финала: файлы → список участников.
//
// Откуда берутся файлы — неважно: папка из `gh classroom clone`, папка от tools/collect-entries.mjs,
// просто несколько .json. Автор определяется по пути: «папка автора/что-угодно.json» или «ник.json».
// Другие JSON (package.json и т. п.) молча пропускаем.
import { parseCarFile, CAR_COLORS } from '../../engine/car-file.js';
import { hashString } from '../../engine/utils.js';

const MAX_FILE_BYTES = 2_000_000;

const stem = (name) => name.replace(/\.json$/i, '');
const splitPath = (path) => path.replace(/\\/g, '/').split('/').filter((s) => s && s !== '.');

/** Общее начало имён вида «ai-race-final-» — отрезаем, чтобы остались ники */
function commonPrefix(names) {
  if (names.length < 2) return '';
  let prefix = names[0];
  for (const n of names) while (!n.startsWith(prefix)) prefix = prefix.slice(0, -1);
  const cut = Math.max(prefix.lastIndexOf('-'), prefix.lastIndexOf('_'));
  prefix = cut >= 0 ? prefix.slice(0, cut + 1) : '';
  return names.every((n) => n.length > prefix.length) ? prefix : '';
}

/** Отпечаток мозга: одинаковый у одинаковых машин (цвет и имя не важны) */
const fingerprint = (p) => hashString(JSON.stringify([p.thinkId, p.code, p.sensors, p.brain])).toString(36);

/**
 * files — [{ path, text }]. Возвращает:
 *  entries   — участники { id, author, name, color, avatar, sensors, sizes, brain, thinkId, code, path, print, twins }
 *  problems  — [{ path, message }] — файлы машин с ошибками и другие замечания
 *  skipped   — сколько файлов не похожи на файл машины
 *  twins     — группы участников с одинаковым мозгом
 */
export function buildEntries(files) {
  const problems = [];
  let skipped = 0;
  let paths = files.map((f) => splitPath(f.path));
  // выбрали папку целиком — первая часть пути у всех одна и та же, она не автор
  if (paths.length && paths.every((p) => p.length >= 2 && p[0] === paths[0][0])) paths = paths.map((p) => p.slice(1));

  const found = [];
  files.forEach((f, i) => {
    const parts = paths[i];
    const path = parts.join('/');
    if (!/\.json$/i.test(path)) return skipped++;
    let json;
    try {
      json = JSON.parse(f.text);
    } catch {
      return skipped++;
    }
    if (!json || typeof json.format !== 'string' || !/car@/.test(json.format)) return skipped++;
    try {
      const parsed = parseCarFile(json);
      found.push({ ...parsed, path, folder: parts.length >= 2 ? parts[0] : null, file: parts.at(-1) });
    } catch (e) {
      problems.push({ path, message: e.message });
    }
  });

  // автор: папка, а если файлы лежат вперемешку — имя файла
  const raw = found.map((c) => c.folder ?? stem(c.file));
  const prefix = commonPrefix([...new Set(raw)]);
  const byAuthor = new Map();
  found.forEach((c, i) => {
    const author = raw[i].slice(prefix.length);
    (byAuthor.get(author) ?? byAuthor.set(author, []).get(author)).push(c);
  });

  const entries = [];
  for (const [author, cars] of [...byAuthor].sort(([a], [b]) => a.localeCompare(b))) {
    cars.sort((a, b) => (b.file === 'car.json') - (a.file === 'car.json') || a.path.localeCompare(b.path));
    const [car] = cars;
    if (cars.length > 1) problems.push({ path: car.path, message: `у ${author} несколько файлов машин — взят ${car.path}` });
    entries.push({
      ...car,
      id: author,
      author,
      color: car.color ?? CAR_COLORS[entries.length % CAR_COLORS.length],
      print: fingerprint(car),
    });
  }

  const groups = new Map();
  for (const e of entries) (groups.get(e.print) ?? groups.set(e.print, []).get(e.print)).push(e);
  const twins = [...groups.values()].filter((g) => g.length > 1).sort((a, b) => b.length - a.length);
  for (const e of entries) e.twins = groups.get(e.print).length;

  return { entries, problems, skipped, twins };
}

// ── чтение файлов в браузере ──

async function readFile(file, path) {
  if (file.size > MAX_FILE_BYTES || !/\.json$/i.test(file.name)) return { path, text: '' };
  return { path, text: await file.text() };
}

/** <input type="file" multiple> или <input webkitdirectory> */
export const readFileList = (list) => Promise.all([...list].map((f) => readFile(f, f.webkitRelativePath || f.name)));

/** Перетащили файлы или папки */
export async function readDrop(dataTransfer) {
  const roots = [...dataTransfer.items].map((item) => item.webkitGetAsEntry?.()).filter(Boolean);
  if (!roots.length) return readFileList(dataTransfer.files);
  const out = [];
  const walk = async (entry, prefix) => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      out.push(await readFile(file, path));
    } else if (entry.isDirectory && entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const child of batch) await walk(child, path);
      }
    }
  };
  for (const root of roots) await walk(root, '');
  return out;
}
