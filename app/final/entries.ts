// Работы участников финала: файлы → список участников.
//
// Откуда берутся файлы — неважно: папка из `gh classroom clone`, папка от tools/collect-entries.mjs,
// просто несколько .json. Автор определяется по пути: «папка автора/что-угодно.json» или «ник.json».
// Другие JSON (package.json и т. п.) молча пропускаем.
// Запечатанные файлы (car.sealed.json) сначала открываем секретным ключом курса — см. openSealedFiles.
import { parseCarFile, CAR_COLORS } from '../../engine/car-file.ts';
import type { ParsedCar } from '../../engine/car-file.ts';
import { SEALED_FORMAT, openSealed } from '../../engine/seal.ts';
import type { CourseKey, SealedFile } from '../../engine/seal.ts';
import { hashString } from '../../engine/utils.ts';

const MAX_FILE_BYTES = 2_000_000;
const SIMILAR = 0.97; // косинусное сходство весов, выше которого мозги считаем «похожими»

/** Файл, как его прочитали: путь внутри папки и текст. claimed — логин из печати (у открытого запечатанного файла) */
export type SourceFile = { path: string; text: string; claimed?: string };

/** Замечание к файлу: что с ним не так */
export type Problem = { path: string; message: string };

/**
 * Участник финала: проверенный файл машины и откуда он взялся.
 * id — ник автора (он же author); claimed — логин из печати (null — файл не запечатан);
 * foreign — логин в печати не совпадает с автором (чужой файл?); print — отпечаток мозга; twins — сколько работ с таким же мозгом;
 * dq — почему снят (есть только у участников посчитанного финала).
 */
export type FinalEntry = Omit<ParsedCar, 'color'> & {
  id: string; author: string; path: string; folder: string | null; file: string;
  claimed: string | null; sealed: boolean; foreign: boolean; color: string; print: string; twins: number;
  dq?: string | null;
};

/** Пара «почти одинаковых» мозгов */
export type SimilarPair = { a: FinalEntry; b: FinalEntry; similarity: number };

/** Что получилось из папки с работами (см. buildEntries) */
export type Works = {
  entries: FinalEntry[]; problems: Problem[]; skipped: number;
  twins: FinalEntry[][]; similar: SimilarPair[]; foreign: FinalEntry[];
};

/** Запечатанные файлы после openSealedFiles */
export type OpenedFiles = { files: SourceFile[]; problems: Problem[]; sealed: number; opened: number; locked: number };

const stem = (name: string) => name.replace(/\.json$/i, '');
const splitPath = (path: string) => path.replace(/\\/g, '/').split('/').filter((s) => s && s !== '.');

/** Положить value в список по ключу key (списки создаются сами) */
function addTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Общее начало имён вида «ai-race-final-» — отрезаем, чтобы остались ники */
function commonPrefix(names: string[]): string {
  if (names.length < 2) return '';
  let prefix = names[0];
  for (const n of names) while (!n.startsWith(prefix)) prefix = prefix.slice(0, -1);
  const cut = Math.max(prefix.lastIndexOf('-'), prefix.lastIndexOf('_'));
  prefix = cut >= 0 ? prefix.slice(0, cut + 1) : '';
  return names.every((n) => n.length > prefix.length) ? prefix : '';
}

/** Отпечаток мозга: одинаковый у одинаковых машин (цвет и имя не важны) */
const fingerprint = (car: ParsedCar) => hashString(JSON.stringify([car.thinkId, car.code, car.sensors, car.brain])).toString(36);

/** JSON из чужого файла: что внутри — заранее неизвестно */
function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
/** Поле format у JSON, если оно есть */
const formatOf = (json: unknown): unknown => (typeof json === 'object' && json !== null && 'format' in json ? json.format : undefined);
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Открыть запечатанные файлы. key — результат importPrivateKey или null (ключ ещё не выбран).
 * files в ответе — те же, но запечатанные заменены открытыми ({ path, text, claimed — логин из печати }),
 * locked — сколько ждут ключа.
 */
export async function openSealedFiles(files: SourceFile[], key: CourseKey | null): Promise<OpenedFiles> {
  const out: SourceFile[] = [];
  const problems: Problem[] = [];
  let sealed = 0, locked = 0;
  for (const f of files) {
    const json = /\.json$/i.test(f.path) ? tryJson(f.text) : null;
    if (formatOf(json) !== SEALED_FORMAT) {
      out.push(f);
      continue;
    }
    sealed++;
    if (!key) {
      locked++;
      continue;
    }
    try {
      const { login, car } = await openSealed(json as SealedFile, key); // формат проверили выше, остальное проверит openSealed
      out.push({ path: f.path, text: JSON.stringify(car), claimed: String(login ?? '') });
    } catch (e) {
      problems.push({ path: f.path, message: messageOf(e) });
    }
  }
  // одна и та же беда у многих файлов (например, не тот ключ) — одной строкой
  const byMessage = new Map<string, Problem[]>();
  for (const p of problems) addTo(byMessage, p.message, p);
  const grouped = [...byMessage.values()].flatMap((list) => (list.length > 3 ? [{ path: `${list.length} файлов`, message: list[0].message }] : list));
  return { files: out, problems: grouped, sealed, opened: sealed - locked - problems.length, locked };
}

/** Файл машины, найденный в папке, — ещё без автора */
type Found = ParsedCar & { path: string; folder: string | null; file: string; claimed: string | null };

/**
 * Файлы → участники. В ответе:
 *  entries   — участники по алфавиту;
 *  problems  — файлы машин с ошибками и другие замечания;
 *  skipped   — сколько файлов не похожи на файл машины;
 *  twins     — группы участников с одинаковым мозгом;
 *  similar   — пары «почти одинаковых» мозгов;
 *  foreign   — участники, у которых логин в печати не совпадает с автором (чужой файл?).
 */
export function buildEntries(files: SourceFile[]): Works {
  const problems: Problem[] = [];
  let skipped = 0;
  let paths = files.map((f) => splitPath(f.path));
  // выбрали папку целиком — первая часть пути у всех одна и та же, она не автор
  if (paths.length && paths.every((p) => p.length >= 2 && p[0] === paths[0][0])) paths = paths.map((p) => p.slice(1));

  const found: Found[] = [];
  files.forEach((f, i) => {
    const parts = paths[i];
    const path = parts.join('/');
    const json = /\.json$/i.test(path) ? tryJson(f.text) : null;
    const format = formatOf(json);
    if (typeof format !== 'string' || !/car@/.test(format)) {
      skipped++;
      return;
    }
    try {
      const car = parseCarFile(json);
      found.push({ ...car, path, folder: parts.length >= 2 ? parts[0] : null, file: parts[parts.length - 1], claimed: f.claimed ?? null });
    } catch (e) {
      problems.push({ path, message: messageOf(e) });
    }
  });

  // автор: папка; если файлы лежат вперемешку — логин из печати или имя файла
  const raw = found.map((c) => c.folder ?? (c.claimed || stem(c.file)));
  const prefix = commonPrefix([...new Set(raw)]);
  const byAuthor = new Map<string, Found[]>();
  found.forEach((c, i) => addTo(byAuthor, raw[i].slice(prefix.length), c));

  const entries: FinalEntry[] = [];
  for (const [author, cars] of [...byAuthor].sort(([a], [b]) => a.localeCompare(b))) {
    // запечатанный файл важнее открытого, car.json — важнее других имён
    cars.sort((a, b) => Number(!!b.claimed) - Number(!!a.claimed) || Number(b.file === 'car.json') - Number(a.file === 'car.json') || a.path.localeCompare(b.path));
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
      twins: 1, // посчитаем ниже, когда соберём всех
    });
  }

  const groups = new Map<string, FinalEntry[]>();
  for (const e of entries) addTo(groups, e.print, e);
  const twins = [...groups.values()].filter((g) => g.length > 1).sort((a, b) => b.length - a.length);
  for (const e of entries) e.twins = groups.get(e.print)?.length ?? 1;

  return { entries, problems, skipped, twins, similar: similarPairs(entries), foreign: entries.filter((e) => e.foreign) };
}

/**
 * «Почти одинаковые» мозги: скопировали и чуть-чуть пошевелили веса.
 * Веса сети — вектор чисел; у независимо обученных сетей направления разные (сходство около 0),
 * у копии с мелкими правками — почти одно и то же (сходство около 1).
 */
function similarPairs(entries: FinalEntry[]): SimilarPair[] {
  const bySize = new Map<string, { e: FinalEntry; v: number[] }[]>();
  for (const e of entries) {
    const flat = e.brain.layers.flatMap((l) => [...l.weights.flat(), ...l.biases]);
    const norm = Math.sqrt(flat.reduce((sum, x) => sum + x * x, 0)) || 1; // не Math.hypot(...flat): большой мозг — много аргументов
    addTo(bySize, e.sizes.join('-'), { e, v: flat.map((x) => x / norm) });
  }
  const pairs: SimilarPair[] = [];
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

/** Большие и не-JSON файлы не читаем: они всё равно не машины */
async function readFile(file: File, path: string): Promise<SourceFile> {
  if (file.size > MAX_FILE_BYTES || !/\.json$/i.test(file.name)) return { path, text: '' };
  return { path, text: await file.text() };
}

/** <input type="file" multiple> или <input webkitdirectory> */
export const readFileList = (list: FileList | File[]): Promise<SourceFile[]> =>
  Promise.all([...list].map((f) => readFile(f, f.webkitRelativePath || f.name)));

/** Перетащили файлы или папки */
export async function readDrop(dataTransfer: DataTransfer): Promise<SourceFile[]> {
  const roots = [...dataTransfer.items].map((item) => item.webkitGetAsEntry?.()).filter((entry) => !!entry);
  if (!roots.length) return readFileList(dataTransfer.files);
  const out: SourceFile[] = [];
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (isFile(entry)) {
      const file = await new Promise<File>((res, rej) => entry.file(res, rej));
      out.push(await readFile(file, path));
    } else if (isDirectory(entry) && entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
      const reader = entry.createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break; // readEntries отдаёт папку частями, пустая часть — конец
        for (const child of batch) await walk(child, path);
      }
    }
  };
  for (const root of roots) await walk(root, '');
  return out;
}

const isFile = (entry: FileSystemEntry): entry is FileSystemFileEntry => entry.isFile;
const isDirectory = (entry: FileSystemEntry): entry is FileSystemDirectoryEntry => entry.isDirectory;
