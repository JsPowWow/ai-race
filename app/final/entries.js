// Работы участников финала: файлы → список участников.
//
// Откуда берутся файлы — неважно: папка из `gh classroom clone`, папка от tools/collect-entries.mjs,
// просто несколько .json. Автор определяется по пути: «папка автора/что-угодно.json» или «ник.json».
// Другие JSON (package.json и т. п.) молча пропускаем.
// Запечатанные файлы (car.sealed.json) сначала открываем секретным ключом курса — см. openSealedFiles.
import { parseCarFile, CAR_COLORS } from '../../engine/car-file.js';
import { SEALED_FORMAT, openSealed } from '../../engine/seal.js';
import { hashString } from '../../engine/utils.js';

const MAX_FILE_BYTES = 2_000_000;
const SIMILAR = 0.97; // косинусное сходство весов, выше которого мозги считаем «похожими»

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

const tryJson = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/**
 * Открыть запечатанные файлы. key — результат importPrivateKey или null (ключ ещё не выбран).
 * Возвращает { files, problems, sealed, opened, locked }: files — те же, но запечатанные заменены открытыми
 * ({ path, text, claimed — логин из печати }), locked — сколько ждут ключа.
 */
export async function openSealedFiles(files, key) {
  const out = [];
  const problems = [];
  let sealed = 0, locked = 0;
  for (const f of files) {
    const json = /\.json$/i.test(f.path) ? tryJson(f.text) : null;
    if (json?.format !== SEALED_FORMAT) {
      out.push(f);
      continue;
    }
    sealed++;
    if (!key) {
      locked++;
      continue;
    }
    try {
      const { login, car } = await openSealed(json, key);
      out.push({ path: f.path, text: JSON.stringify(car), claimed: String(login ?? '') });
    } catch (e) {
      problems.push({ path: f.path, message: e.message });
    }
  }
  // одна и та же беда у многих файлов (например, не тот ключ) — одной строкой
  const byMessage = new Map();
  for (const p of problems) (byMessage.get(p.message) ?? byMessage.set(p.message, []).get(p.message)).push(p);
  const grouped = [...byMessage.values()].flatMap((list) => (list.length > 3 ? [{ path: `${list.length} файлов`, message: list[0].message }] : list));
  return { files: out, problems: grouped, sealed, opened: sealed - locked - problems.length, locked };
}

/**
 * files — [{ path, text, claimed? }]. Возвращает:
 *  entries   — участники { id, author, claimed, foreign, name, color, avatar, sensors, sizes, brain, thinkId, code, path, print, twins }
 *  problems  — [{ path, message }] — файлы машин с ошибками и другие замечания
 *  skipped   — сколько файлов не похожи на файл машины
 *  twins     — группы участников с одинаковым мозгом
 *  similar   — пары «почти одинаковых» мозгов: [{ a, b, similarity }]
 *  foreign   — участники, у которых логин в печати не совпадает с автором (чужой файл?)
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
    const json = tryJson(f.text);
    if (!json || typeof json.format !== 'string' || !/car@/.test(json.format)) return skipped++;
    try {
      const parsed = parseCarFile(json);
      found.push({ ...parsed, path, folder: parts.length >= 2 ? parts[0] : null, file: parts.at(-1), claimed: f.claimed ?? null });
    } catch (e) {
      problems.push({ path, message: e.message });
    }
  });

  // автор: папка; если файлы лежат вперемешку — логин из печати или имя файла
  const raw = found.map((c) => c.folder ?? (c.claimed || stem(c.file)));
  const prefix = commonPrefix([...new Set(raw)]);
  const byAuthor = new Map();
  found.forEach((c, i) => {
    const author = raw[i].slice(prefix.length);
    (byAuthor.get(author) ?? byAuthor.set(author, []).get(author)).push(c);
  });

  const entries = [];
  for (const [author, cars] of [...byAuthor].sort(([a], [b]) => a.localeCompare(b))) {
    // запечатанный файл важнее открытого, car.json — важнее других имён
    cars.sort((a, b) => !!b.claimed - !!a.claimed || (b.file === 'car.json') - (a.file === 'car.json') || a.path.localeCompare(b.path));
    const [car] = cars;
    if (cars.length > 1) problems.push({ path: car.path, message: `у ${author} несколько файлов машин — взят ${car.path}` });
    entries.push({
      ...car,
      id: author,
      author,
      sealed: car.claimed !== null,
      foreign: car.claimed !== null && car.claimed.toLowerCase() !== author.toLowerCase(),
      color: car.color ?? CAR_COLORS[entries.length % CAR_COLORS.length],
      print: fingerprint(car),
    });
  }

  const groups = new Map();
  for (const e of entries) (groups.get(e.print) ?? groups.set(e.print, []).get(e.print)).push(e);
  const twins = [...groups.values()].filter((g) => g.length > 1).sort((a, b) => b.length - a.length);
  for (const e of entries) e.twins = groups.get(e.print).length;

  return { entries, problems, skipped, twins, similar: similarPairs(entries), foreign: entries.filter((e) => e.foreign) };
}

/**
 * «Почти одинаковые» мозги: скопировали и чуть-чуть пошевелили веса.
 * Веса сети — вектор чисел; у независимо обученных сетей направления разные (сходство около 0),
 * у копии с мелкими правками — почти одно и то же (сходство около 1).
 */
function similarPairs(entries) {
  const bySize = new Map();
  for (const e of entries) {
    const flat = e.brain.layers.flatMap((l) => [...l.weights.flat(), ...l.biases]);
    const norm = Math.hypot(...flat) || 1;
    const key = e.sizes.join('-');
    (bySize.get(key) ?? bySize.set(key, []).get(key)).push({ e, v: flat.map((x) => x / norm) });
  }
  const pairs = [];
  for (const list of bySize.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        if (a.e.print === b.e.print) continue; // одинаковые целиком — это уже «близнецы»
        let dot = 0;
        for (let k = 0; k < a.v.length; k++) dot += a.v[k] * b.v[k];
        if (dot >= SIMILAR) pairs.push({ a: a.e, b: b.e, similarity: dot });
      }
    }
  }
  return pairs.sort((x, y) => y.similarity - x.similarity);
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
