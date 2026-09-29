// Гараж: несколько машин, одна из них — «твоя» (выбранная). Её учат, проверяют и сдают на всех вкладках.
//
// Машина — это всё, что копится вокруг одного мозга: облик, сборка, мозг, его «История», прогресс роя.
// Поля выбранной машины лежат прямо в state (app/state.ts), остальные машины — только в хранилище
// (app/car-store.ts): каждая — папка cars/<id>/ с car.json, history.json и runs.json («Мои заезды»).
//
// Пересесть в другую машину = записать нынешнюю, прочитать другую и разослать события:
// 'reset', 'config', 'champion', 'library', 'car' — вкладки перерисуются, как после смены мозга.
import { checkBrain } from '../engine/brain.ts';
import type { Profile, CarData, Version } from './state.ts';
import type { CarStore } from './car-store.ts';
import type { DiskFolder } from './car-disk.ts';
import type { Run } from './runs.ts';
import { parseCarFile, checkAvatar, NAME_MAX } from '../engine/car-file.ts';
import { state, blankCar, CAR_KEYS, CAR_COLORS, sizesOf, emit, on } from './state.ts';
import { openCarStore, bytes } from './car-store.ts';
import { runs, setRuns, legacyRuns } from './runs.ts';
import { diskSupported, savedFolder, pickFolder, folderAccess, forgetFolder, diskStore } from './car-disk.ts';
import { load, save, remove, compactJson, usedBytes } from './storage.ts';
import { listen } from '@reely/dommy/kit';

export const MAX_CARS = 12;
const CAR_FORMAT = 'ai-race/garage-car@1';  // car.json: машина без «Истории»
const EXPORT_FORMAT = 'ai-race/garage@1';   // «Сохранить в файл»: машина вместе с «Историей»
const HISTORY_KEEP = 300;                    // точек графика роя храним не больше

/** Файлы машины: ключ → имя файла в её папке */
const FILES = { car: 'car.json', history: 'history.json', runs: 'runs.json' } as const;
type FileKey = keyof typeof FILES;
const FILE_KEYS = Object.keys(FILES) as FileKey[];
/** Тексты файлов машины */
type Files = Record<FileKey, string>;
/** Размеры файлов машины в байтах (у старых сводок заездов может не быть) */
type FileSizes = { car: number; history: number; runs?: number };

/** Сводка машины на полке: читаем только car.json (он маленький), у «Истории» и заездов — размер */
export type CarSummary = {
  id: string; created: number; profile: Profile; shape: string; generation: number; trained: boolean; bytes: FileSizes;
};
/** Машина целиком, как она лежит в файлах: поля state и её заезды */
type FullCar = CarData & { runs: Run[] };
/** car.json, каким его прочитали: ни одному полю верить нельзя, проверяет toCar */
type CarJson = Partial<CarData> & { format?: string; created?: number };

/**
 * Что показывает полка. kind — где лежит гараж, safe — браузер обещал не стирать, usage/quota — место в байтах.
 * disk — копия в папке на диске (app/car-disk.ts): state 'off' — нет, 'ask' — папка выбрана, но ждёт разрешения, 'on' — пишем.
 */
export const garage: {
  ready: boolean; cars: CarSummary[]; id: string; kind: CarStore['kind'] | ''; safe: boolean; usage: number; quota: number; error: string;
  disk: { supported: boolean; state: 'off' | 'ask' | 'on'; name: string; note: string };
} = {
  ready: false, cars: [], id: '', kind: '', safe: false, usage: 0, quota: 0, error: '',
  disk: { supported: false, state: 'off', name: '', note: '' },
};
let store: CarStore | null = null;
let folder: DiskFolder | null = null; // папка на диске, которую выбрали (ручка), даже если писать туда пока нельзя
let disk: CarStore | null = null;     // хранилище в этой папке — только когда писать можно

/** Гараж открыт? До startGarage() хранилища нет */
function opened(): CarStore {
  if (!store) throw new Error('гараж ещё не открыт');
  return store;
}

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const CAR_FIELDS = CAR_KEYS.filter((key) => key !== 'versions');
/** Копия нужных полей машины: в файл и из файла — без общих ссылок с state */
const pick = (source: Partial<CarData>, keys: (keyof CarData)[]): Partial<CarData> =>
  Object.fromEntries(keys.map((key) => [key, structuredClone(source[key])]));

/** Машина (поля state + runs) → тексты её файлов */
const filesOf = (car: FullCar, created: number): Files => ({
  car: compactJson({ format: CAR_FORMAT, created, ...pick(car, CAR_FIELDS), history: car.history.slice(-HISTORY_KEEP) }),
  history: compactJson(car.versions),
  runs: compactJson(car.runs ?? []),
});
const sizesOfFiles = (files: Partial<Files>): FileSizes => ({
  car: bytes(files.car ?? ''), history: bytes(files.history ?? ''), runs: bytes(files.runs ?? ''),
});

/** Выбранная машина целиком: её поля лежат в state, а заезды — в app/runs.ts */
const current = (): FullCar => ({ ...state, runs });

const summaryOf = (id: string, car: CarJson & Pick<CarData, 'profile' | 'config'>, sizes: FileSizes): CarSummary => ({
  id, created: car.created ?? 0, profile: car.profile, shape: sizesOf(car.config).join('-'),
  generation: car.generation ?? 0, trained: !!car.champion, bytes: sizes,
});

/** car.json гаража: текст → машина, если это она (с обликом и сборкой), иначе null */
function parseCarJson(text: string | null): (CarJson & Pick<CarData, 'profile' | 'config'>) | null {
  try {
    const car: CarJson | null = JSON.parse(text ?? 'null');
    return car?.format === CAR_FORMAT && car.profile && car.config?.sensors && Array.isArray(car.config.hidden) ? { ...car, profile: car.profile, config: car.config } : null;
  } catch {
    return null;
  }
}

/** Прочитанная машина → поля для state. Бросает Error, если это не машина */
function toCar(car: CarJson | null, versions: unknown, runList: unknown): FullCar {
  if (!car?.config?.sensors || !Array.isArray(car.config.hidden)) throw new Error('это не машина гаража');
  const next: FullCar = {
    ...blankCar(), ...pick({ ...blankCar(), ...car }, CAR_FIELDS),
    versions: Array.isArray(versions) ? (versions as Version[]) : [],
    runs: Array.isArray(runList) ? (runList as Run[]).filter((r) => Array.isArray(r?.packed)) : [],
  };
  next.profile = { ...blankCar().profile, ...car.profile, name: String(car.profile?.name ?? '').slice(0, NAME_MAX) };
  delete next.profile.login; // логин — общий для всех машин
  try {
    next.profile.avatar = checkAvatar(next.profile.avatar) ?? undefined;
  } catch {
    delete next.profile.avatar;
  }
  // Мозг другой формы (например, сохранённый до памяти, #4): на нём машина не поедет — начинаем с чистого листа
  if (next.champion && checkBrain(next.champion, sizesOf(next.config))) {
    Object.assign(next, { champion: null, generation: 0, history: [], hall: [], handEdited: false, brainNote: '' });
  }
  return next;
}

// ── запись выбранной машины ──

let dirty = false, timer = 0, writing = Promise.resolve();
const written = new Map<string, Partial<Files>>(); // что уже лежит в файлах машины — одинаковое не переписываем

async function writeFiles(id: string, files: Files): Promise<void> {
  const before = written.get(id) ?? {};
  for (const key of FILE_KEYS) {
    if (files[key] === before[key]) continue;
    await opened().write(id, FILES[key], files[key]);
    await copyToDisk(id, FILES[key], files[key]);
  }
  written.set(id, files);
}

// ── копия в папке на диске ──

const GONE = 'garageGone'; // машины, удалённые, пока папка ждала разрешения: при встрече удалим и там

/** Записать файл ещё и в папку на диске. Не вышло (папку удалили, отняли доступ) — гараж работает дальше без неё */
async function copyToDisk(id: string, name: string, text: string): Promise<void> {
  if (!disk) return;
  try {
    await disk.write(id, name, text);
  } catch (e) {
    disk = null;
    Object.assign(garage.disk, { state: 'ask', note: `Не получилось записать в папку: ${messageOf(e)}` });
  }
}

/**
 * Встреча с папкой: машины, которых на полке нет (например, после очистки браузера), приезжают из папки,
 * а все машины полки записываются в папку. Если машина есть и там, и тут — права полка: она рабочая копия.
 */
async function syncDisk(): Promise<number> {
  const target = disk;
  if (!target) return 0;
  const home = opened();
  const shelf = new Set(await home.list());
  const gone = load<string[]>(GONE, []);
  let skipped = 0;
  for (const id of await target.list()) {
    if (gone.includes(id)) {
      await target.remove(id);
      continue;
    }
    if (shelf.has(id)) continue;
    const text = await target.read(id, FILES.car);
    const car = parseCarJson(text);
    if (!text || !car) continue; // испорченный файл пропускаем
    if (isFull()) {
      skipped++;
      continue;
    }
    const files: Files = {
      car: text,
      history: (await target.read(id, FILES.history)) ?? '[]',
      runs: (await target.read(id, FILES.runs)) ?? '[]',
    };
    for (const key of FILE_KEYS) await home.write(id, FILES[key], files[key]);
    garage.cars.push(summaryOf(id, car, sizesOfFiles(files)));
  }
  remove(GONE);
  for (const id of await home.list()) {
    for (const name of Object.values(FILES)) {
      const text = await home.read(id, name);
      if (text !== null) await target.write(id, name, text);
    }
  }
  garage.cars.sort((a, b) => a.created - b.created);
  return skipped;
}

/** Начать писать в папку. ask = true — можно спросить разрешение (только по нажатию кнопки) */
async function useFolder(handle: DiskFolder, ask: boolean): Promise<void> {
  folder = handle;
  Object.assign(garage.disk, { name: handle.name, note: '' });
  try {
    if ((await folderAccess(handle, ask)) !== 'granted') {
      garage.disk.state = 'ask';
      return;
    }
    disk = diskStore(handle);
    await flush();
    const skipped = await syncDisk();
    garage.disk.state = 'on';
    if (skipped) garage.disk.note = `В папке есть ещё машины (${skipped}), но на полке нет места — удали лишние и нажми «Перестать копировать», потом снова выбери папку.`;
  } catch (e) {
    disk = null;
    Object.assign(garage.disk, { state: 'ask', note: `Папка не открылась: ${messageOf(e)}` });
  }
}

/** «Хранить копию в папке на диске»: выбрать папку. Вызывать по нажатию кнопки */
export async function chooseFolder(): Promise<void> {
  let handle: DiskFolder;
  try {
    handle = await pickFolder();
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return; // передумал — ничего не меняем
    throw e;
  }
  await useFolder(handle, true);
  await afterFolder();
}

/** После перезапуска браузер снова спрашивает разрешение — по нажатию «Разрешить» */
export async function allowFolder(): Promise<void> {
  if (!folder) return;
  await useFolder(folder, true);
  await afterFolder();
}

/** «Перестать»: больше не пишем в папку. Файлы в ней остаются — это обычная папка */
export async function stopFolder(): Promise<void> {
  await forgetFolder();
  folder = disk = null;
  remove(GONE);
  Object.assign(garage.disk, { state: 'off', name: '', note: '' });
  emit('garage');
}

async function afterFolder(): Promise<void> {
  await measure();
  emit('garage'); // полка перерисуется: могли приехать машины из папки
}

/** Записать выбранную машину сейчас (ждать не обязательно: записи идут по очереди) */
export function flush(): Promise<void> {
  clearTimeout(timer);
  if (!dirty || !store || !garage.id) return writing;
  dirty = false;
  const id = garage.id;
  const summary = garage.cars.find((c) => c.id === id);
  const files = filesOf(current(), summary?.created ?? Date.now());
  writing = writing.then(() => writeFiles(id, files)).then(() => {
    if (load<Pending | null>(PENDING, null)?.files?.car === files.car) remove(PENDING); // успели — страховка не нужна
    garage.error = '';
    if (summary) Object.assign(summary, summaryOf(id, JSON.parse(files.car), sizesOfFiles(files)));
    return measure();
  }).catch((e) => {
    garage.error = `Не получилось сохранить машину: ${messageOf(e)}`;
    dirty = true; // попробуем ещё раз при следующей перемене
  }).then(() => emit('garage'));
  return writing;
}

on('save', () => {
  dirty = true;
  clearTimeout(timer);
  timer = setTimeout(flush, 300);
});

// Закрыли вкладку или перезагрузили страницу: Worker могут остановить раньше, чем он допишет файл.
// Поэтому несохранённую машину сразу, синхронно кладём в localStorage, а при следующем старте дописываем в гараж.
const PENDING = 'carPending';
/** Страховка в localStorage: машина, которую не успели записать */
type Pending = { id: string; files: Files };
function rescue(): void {
  if (!dirty || !store || !garage.id) return;
  const summary = garage.cars.find((c) => c.id === garage.id);
  save(PENDING, { id: garage.id, files: filesOf(current(), summary?.created ?? Date.now()) });
  flush();
}
listen(document, 'visibilitychange', () => document.visibilityState === 'hidden' && rescue());
listen(window, 'pagehide', rescue);

/** Дописать то, что не успели записать в прошлый раз */
async function writePending(): Promise<void> {
  const pending = load<Pending | null>(PENDING, null);
  if (!pending?.id || !pending.files) return;
  await writeFiles(pending.id, pending.files);
  remove(PENDING);
}

// ── чтение ──

async function readCar(id: string): Promise<{ car: CarJson | null; versions: unknown; runs: unknown }> {
  const home = opened();
  const car: CarJson | null = JSON.parse((await home.read(id, FILES.car)) ?? 'null');
  const versions: unknown = JSON.parse((await home.read(id, FILES.history)) ?? '[]');
  const runList: unknown = JSON.parse((await home.read(id, FILES.runs)) ?? '[]');
  return { car, versions, runs: runList };
}

/** Посадить в машину: её поля — в state, вкладкам — события */
function seat(id: string, { runs: runList, ...car }: FullCar): void {
  Object.assign(state, car);
  setRuns(runList);
  garage.id = id;
  save('car', id);
  emit('reset');
  emit('config');
  emit('champion', { by: 'car' });
  emit('library');
  emit('car');
  emit('garage');
}

/** Сколько места занято и сколько браузер даёт сайту */
async function measure(): Promise<void> {
  if (opened().kind === 'local') {
    Object.assign(garage, { usage: usedBytes(), quota: 5 * 1024 ** 2 });
    return;
  }
  const estimate = await navigator.storage.estimate?.().catch(() => null);
  if (estimate) Object.assign(garage, { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 });
}

// ── переезд: до гаража машина лежала в localStorage отдельными ключами ──

const LEGACY = ['profile', 'config', 'champion', 'generation', 'history', 'hall', 'handEdited', 'brainNote', 'versions', 'library', 'previous', 'libraryId'];

/** Была библиотека по кнопке и один «прежний» мозг — теперь одна история: сохранённые вручную закрепляем */
function legacyVersions(): Version[] {
  type Saved = Version & { name?: string; savedAt?: string };
  const saved = (load<Saved[] | null>('library', []) ?? []).map((e): Version => ({ ...e, brainNote: e.name || e.brainNote, at: e.savedAt ?? e.at, pinned: true }));
  const previous = load<Omit<Version, 'id' | 'at' | 'pinned'> | null>('previous', null);
  return previous ? [{ id: 'prev', at: new Date().toISOString(), ...previous, pinned: false }, ...saved] : saved;
}

function legacyCar(): { car: CarJson; versions: Version[]; runs: Run[] } {
  const saved = CAR_FIELDS.filter((key) => key !== 'profile').map((key) => [key, load<unknown>(key, null)]).filter(([, value]) => value !== null);
  const car: CarJson = { ...blankCar(load<Partial<Profile>>('profile', {})), ...Object.fromEntries(saved) };
  return { car, versions: load<Version[] | null>('versions', null) ?? legacyVersions(), runs: legacyRuns() };
}

// ── старт ──

/** Открыть гараж и сесть в выбранную машину. Вызывается один раз при загрузке страницы */
export async function startGarage(): Promise<void> {
  store = await openCarStore();
  garage.kind = store.kind;
  await writePending();
  await loadShelf();
  garage.disk.supported = diskSupported();
  const saved = garage.disk.supported ? await savedFolder() : null;
  if (saved) await useFolder(saved, false); // браузер помнит разрешение — пишем сразу; нет — покажем «Разрешить»
  if (!garage.cars.length) {
    // Первый запуск: всё, что было в localStorage, становится первой машиной гаража
    const { car, versions, runs: runList } = legacyCar();
    const id = await addCar(toCar(car, versions, runList));
    for (const key of LEGACY) remove(key); // машина уже в гараже — освобождаем место в localStorage
    save('car', id);
  }
  const wanted = load<string>('car', '');
  const first = garage.cars[0];
  if (!first) throw new Error('в гараже нет ни одной машины');
  await openCar(garage.cars.some((c) => c.id === wanted) ? wanted : first.id);
  garage.safe = (await navigator.storage.persist?.().catch(() => false)) ?? false;
  await measure();
  garage.ready = true;
  emit('garage');
}

/** Сводки всех машин: читаем car.json (он маленький), у «Истории» — только размер */
async function loadShelf(): Promise<void> {
  const home = opened();
  const cars: CarSummary[] = [];
  for (const id of await home.list()) {
    const text = await home.read(id, FILES.car);
    const car = parseCarJson(text);
    if (!text || !car) continue; // испорченную папку пропускаем
    cars.push(summaryOf(id, car, { car: bytes(text), history: await home.size(id, FILES.history), runs: await home.size(id, FILES.runs) }));
  }
  garage.cars = cars.sort((a, b) => a.created - b.created);
}

async function openCar(id: string): Promise<void> {
  const { car, versions, runs: runList } = await readCar(id);
  const next = toCar(car, versions, runList);
  written.set(id, filesOf(next, car?.created ?? Date.now()));
  seat(id, next);
}

/** Положить машину в гараж (в конец полки) — вернёт её id */
async function addCar(car: FullCar): Promise<string> {
  const id = newId();
  const created = Date.now();
  const files = filesOf(car, created);
  await writeFiles(id, files);
  garage.cars.push(summaryOf(id, { ...car, created }, sizesOfFiles(files)));
  return id;
}

// ── действия полки ──

export const isFull = (): boolean => garage.cars.length >= MAX_CARS;

/** Пересесть в другую машину: нынешняя сначала записывается */
export async function switchCar(id: string): Promise<void> {
  if (id === garage.id || !garage.cars.some((c) => c.id === id)) return;
  await flush();
  await openCar(id);
}

/** Цвет, которого ещё нет в гараже */
const freeColor = (): string => CAR_COLORS.find((c) => !garage.cars.some((car) => car.profile.color === c)) ?? CAR_COLORS[garage.cars.length % CAR_COLORS.length];

/** Новая пустая машина — и сразу в неё */
export async function newCar(): Promise<void> {
  if (isFull()) return;
  await flush();
  const id = await addCar({ ...blankCar({ name: `Машина ${garage.cars.length + 1}`, color: freeColor() }), runs: [] });
  await openCar(id);
}

/** Копия выбранной машины вместе с мозгом и «Историей» — и сразу в неё */
export async function copyCar(): Promise<void> {
  if (isFull()) return;
  await flush();
  const copy = { ...(pick(state, CAR_KEYS) as CarData), runs: structuredClone(runs) };
  copy.profile.name = `${state.profile.name || 'Машина'} — копия`.slice(0, NAME_MAX);
  copy.profile.color = freeColor();
  const id = await addCar(copy);
  await openCar(id);
}

/** Удалить машину. Последнюю — нельзя; выбранную — сначала пересаживаемся в соседнюю */
export async function deleteCar(id: string): Promise<void> {
  if (garage.cars.length <= 1) return;
  if (id === garage.id) {
    const i = garage.cars.findIndex((c) => c.id === id);
    dirty = false; // её не записываем: всё равно удаляем
    const next = garage.cars[i + 1] ?? garage.cars[i - 1];
    if (next) await openCar(next.id);
  }
  await opened().remove(id);
  if (disk) await disk.remove(id).catch(() => {});
  else if (folder) save(GONE, [...load<string[]>(GONE, []), id]);
  written.delete(id);
  garage.cars = garage.cars.filter((c) => c.id !== id);
  await measure();
  emit('garage');
}

/** Файл выбранной машины вместе с «Историей»: { name — имя машины для имени файла, text } */
export async function exportCar(): Promise<{ name: string; text: string }> {
  await flush();
  const name = state.profile.name.trim() || 'машина';
  return { name, text: compactJson({ format: EXPORT_FORMAT, car: { ...pick(state, CAR_FIELDS) }, versions: state.versions, runs }) };
}

/**
 * Открыть машину из файла — и сразу в неё. Подходит файл гаража (с «Историей»)
 * и файл машины для гонки (car@3) — тогда в гараж приходят облик, сборка и мозг. Бросает Error.
 */
export async function importCar(text: string): Promise<void> {
  if (isFull()) throw new Error(`в гараже уже ${MAX_CARS} машин — удали лишнюю`);
  let file: { format?: string; car?: CarJson; versions?: unknown; runs?: unknown; trainedGenerations?: number } | null;
  try {
    file = JSON.parse(text);
  } catch {
    throw new Error('это не JSON');
  }
  let car;
  if (file?.format === EXPORT_FORMAT) {
    car = toCar(file.car ?? null, file.versions, file.runs);
  } else {
    const race = parseCarFile(file); // бросит понятную ошибку, если это не машина
    car = toCar({
      profile: { name: race.name, color: race.color ?? freeColor(), avatar: race.avatar ?? undefined },
      config: { sensors: race.sensors, hidden: race.sizes.slice(1, -1), think: race.thinkId },
      champion: race.brain, generation: file?.trainedGenerations ?? 0, brainNote: 'из файла машины',
    }, [], []);
  }
  await flush();
  const id = await addCar(car);
  await openCar(id);
}
