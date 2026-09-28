// Гараж: несколько машин, одна из них — «твоя» (выбранная). Её учат, проверяют и сдают на всех вкладках.
//
// Машина — это всё, что копится вокруг одного мозга: облик, сборка, мозг, его «История», прогресс роя.
// Поля выбранной машины лежат прямо в state (app/state.js), остальные машины — только в хранилище
// (app/car-store.js): каждая — папка cars/<id>/ с car.json, history.json и runs.json («Мои заезды»).
//
// Пересесть в другую машину = записать нынешнюю, прочитать другую и разослать события:
// 'reset', 'config', 'champion', 'library', 'car' — вкладки перерисуются, как после смены мозга.
import { checkBrain } from '../engine/brain.ts';
import { parseCarFile, checkAvatar, NAME_MAX } from '../engine/car-file.ts';
import { state, blankCar, CAR_KEYS, CAR_COLORS, sizesOf, emit, on } from './state.js';
import { openCarStore, bytes } from './car-store.js';
import { runs, setRuns, legacyRuns } from './runs.js';
import { diskSupported, savedFolder, pickFolder, folderAccess, forgetFolder, diskStore } from './car-disk.js';
import { load, save, remove, compactJson, usedBytes } from './storage.js';

export const MAX_CARS = 12;
const CAR_FORMAT = 'ai-race/garage-car@1';  // car.json: машина без «Истории»
const EXPORT_FORMAT = 'ai-race/garage@1';   // «Сохранить в файл»: машина вместе с «Историей»
const HISTORY_KEEP = 300;                    // точек графика роя храним не больше

/**
 * Что показывает полка. cars — сводки машин, не вся машина: [{ id, created, profile, shape, generation, trained, bytes: { car, history, runs } }].
 * kind — где лежит гараж ('opfs' | 'local'), safe — браузер обещал не стирать, usage/quota — место в байтах.
 * disk — копия в папке на диске (app/car-disk.js): state 'off' — нет, 'ask' — папка выбрана, но ждёт разрешения, 'on' — пишем.
 */
export const garage = {
  ready: false, cars: [], id: '', kind: '', safe: false, usage: 0, quota: 0, error: '',
  disk: { supported: false, state: 'off', name: '', note: '' },
};
let store = null;
let folder = null; // папка на диске, которую выбрали (ручка), даже если писать туда пока нельзя
let disk = null;   // хранилище в этой папке — только когда писать можно

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const pick = (source, keys) => Object.fromEntries(keys.map((key) => [key, structuredClone(source[key])]));
const CAR_FIELDS = CAR_KEYS.filter((key) => key !== 'versions');

/** Файлы машины: ключ → имя файла в её папке */
const FILES = { car: 'car.json', history: 'history.json', runs: 'runs.json' };

/** Машина (поля state + runs) → тексты её файлов */
const filesOf = (car, created) => ({
  car: compactJson({ format: CAR_FORMAT, created, ...pick(car, CAR_FIELDS), history: car.history.slice(-HISTORY_KEEP) }),
  history: compactJson(car.versions),
  runs: compactJson(car.runs ?? []),
});
const sizesOfFiles = (files) => Object.fromEntries(Object.keys(FILES).map((key) => [key, bytes(files[key] ?? '')]));

/** Выбранная машина целиком: её поля лежат в state, а заезды — в app/runs.js */
const current = () => ({ ...state, runs });

const summaryOf = (id, car, sizes) => ({
  id, created: car.created ?? 0, profile: car.profile, shape: sizesOf(car.config).join('-'),
  generation: car.generation ?? 0, trained: !!car.champion, bytes: sizes,
});

/** Прочитанная машина → поля для state. Бросает Error, если это не машина */
function toCar(car, versions, runList) {
  if (!car?.config?.sensors || !Array.isArray(car.config.hidden)) throw new Error('это не машина гаража');
  const next = { ...blankCar(), ...pick({ ...blankCar(), ...car }, CAR_FIELDS), versions: Array.isArray(versions) ? versions : [],
    runs: Array.isArray(runList) ? runList.filter((r) => Array.isArray(r?.packed)) : [] };
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
const written = new Map(); // id → { car, history, runs }: что уже лежит в файлах — одинаковое не переписываем

async function writeFiles(id, files) {
  const before = written.get(id) ?? {};
  for (const [key, name] of Object.entries(FILES)) {
    if (files[key] === before[key]) continue;
    await store.write(id, name, files[key]);
    await copyToDisk(id, name, files[key]);
  }
  written.set(id, files);
}

// ── копия в папке на диске ──

const GONE = 'garageGone'; // машины, удалённые, пока папка ждала разрешения: при встрече удалим и там

/** Записать файл ещё и в папку на диске. Не вышло (папку удалили, отняли доступ) — гараж работает дальше без неё */
async function copyToDisk(id, name, text) {
  if (!disk) return;
  try {
    await disk.write(id, name, text);
  } catch (e) {
    disk = null;
    Object.assign(garage.disk, { state: 'ask', note: `Не получилось записать в папку: ${e.message}` });
  }
}

/**
 * Встреча с папкой: машины, которых на полке нет (например, после очистки браузера), приезжают из папки,
 * а все машины полки записываются в папку. Если машина есть и там, и тут — права полка: она рабочая копия.
 */
async function syncDisk() {
  const shelf = new Set(await store.list());
  const gone = load(GONE, []);
  let skipped = 0;
  for (const id of await disk.list()) {
    if (gone.includes(id)) {
      await disk.remove(id);
      continue;
    }
    if (shelf.has(id)) continue;
    const text = await disk.read(id, 'car.json');
    let car = null;
    try {
      car = JSON.parse(text ?? 'null');
    } catch { /* испорченный файл пропускаем */ }
    if (car?.format !== CAR_FORMAT) continue;
    if (isFull()) {
      skipped++;
      continue;
    }
    const files = { car: text };
    for (const key of ['history', 'runs']) files[key] = (await disk.read(id, FILES[key])) ?? '[]';
    for (const [key, name] of Object.entries(FILES)) await store.write(id, name, files[key]);
    garage.cars.push(summaryOf(id, car, sizesOfFiles(files)));
  }
  remove(GONE);
  for (const id of await store.list()) {
    for (const name of Object.values(FILES)) {
      const text = await store.read(id, name);
      if (text !== null) await disk.write(id, name, text);
    }
  }
  garage.cars.sort((a, b) => a.created - b.created);
  return skipped;
}

/** Начать писать в папку. ask = true — можно спросить разрешение (только по нажатию кнопки) */
async function useFolder(handle, ask) {
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
    Object.assign(garage.disk, { state: 'ask', note: `Папка не открылась: ${e.message}` });
  }
}

/** «Хранить копию в папке на диске»: выбрать папку. Вызывать по нажатию кнопки */
export async function chooseFolder() {
  let handle;
  try {
    handle = await pickFolder();
  } catch (e) {
    if (e.name === 'AbortError') return; // передумал — ничего не меняем
    throw e;
  }
  await useFolder(handle, true);
  await afterFolder();
}

/** После перезапуска браузер снова спрашивает разрешение — по нажатию «Разрешить» */
export async function allowFolder() {
  if (!folder) return;
  await useFolder(folder, true);
  await afterFolder();
}

/** «Перестать»: больше не пишем в папку. Файлы в ней остаются — это обычная папка */
export async function stopFolder() {
  await forgetFolder();
  folder = disk = null;
  remove(GONE);
  Object.assign(garage.disk, { state: 'off', name: '', note: '' });
  emit('garage');
}

async function afterFolder() {
  await measure();
  emit('garage'); // полка перерисуется: могли приехать машины из папки
}

/** Записать выбранную машину сейчас (ждать не обязательно: записи идут по очереди) */
export function flush() {
  clearTimeout(timer);
  if (!dirty || !store || !garage.id) return writing;
  dirty = false;
  const id = garage.id;
  const summary = garage.cars.find((c) => c.id === id);
  const files = filesOf(current(), summary?.created ?? Date.now());
  writing = writing.then(() => writeFiles(id, files)).then(() => {
    if (load(PENDING, null)?.files?.car === files.car) remove(PENDING); // успели — страховка не нужна
    garage.error = '';
    if (summary) Object.assign(summary, summaryOf(id, JSON.parse(files.car), sizesOfFiles(files)));
    return measure();
  }).catch((e) => {
    garage.error = `Не получилось сохранить машину: ${e.message}`;
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
function rescue() {
  if (!dirty || !store || !garage.id) return;
  const summary = garage.cars.find((c) => c.id === garage.id);
  save(PENDING, { id: garage.id, files: filesOf(current(), summary?.created ?? Date.now()) });
  flush();
}
document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && rescue());
addEventListener('pagehide', rescue);

/** Дописать то, что не успели записать в прошлый раз */
async function writePending() {
  const pending = load(PENDING, null);
  if (!pending?.id || !pending.files) return;
  await writeFiles(pending.id, pending.files);
  remove(PENDING);
}

// ── чтение ──

async function readCar(id) {
  const car = JSON.parse((await store.read(id, 'car.json')) ?? 'null');
  const versions = JSON.parse((await store.read(id, 'history.json')) ?? '[]');
  const runList = JSON.parse((await store.read(id, 'runs.json')) ?? '[]');
  return { car, versions, runs: runList };
}

/** Посадить в машину: её поля — в state, вкладкам — события */
function seat(id, { runs: runList, ...car }) {
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
async function measure() {
  if (store.kind === 'local') {
    Object.assign(garage, { usage: usedBytes(), quota: 5 * 1024 ** 2 });
    return;
  }
  const estimate = await navigator.storage.estimate?.().catch(() => null);
  if (estimate) Object.assign(garage, { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 });
}

// ── переезд: до гаража машина лежала в localStorage отдельными ключами ──

const LEGACY = ['profile', 'config', 'champion', 'generation', 'history', 'hall', 'handEdited', 'brainNote', 'versions', 'library', 'previous', 'libraryId'];

/** Была библиотека по кнопке и один «прежний» мозг — теперь одна история: сохранённые вручную закрепляем */
function legacyVersions() {
  const saved = (load('library', []) ?? []).map((e) => ({ ...e, brainNote: e.name || e.brainNote, at: e.savedAt ?? e.at, pinned: true }));
  const previous = load('previous', null);
  return previous ? [{ id: 'prev', at: new Date().toISOString(), ...previous, pinned: false }, ...saved] : saved;
}

function legacyCar() {
  const saved = CAR_FIELDS.filter((key) => key !== 'profile').map((key) => [key, load(key, null)]).filter(([, value]) => value !== null);
  const car = { ...blankCar(load('profile', {})), ...Object.fromEntries(saved) };
  return { car, versions: load('versions', null) ?? legacyVersions(), runs: legacyRuns() };
}

// ── старт ──

/** Открыть гараж и сесть в выбранную машину. Вызывается один раз при загрузке страницы */
export async function startGarage() {
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
  const wanted = load('car', '');
  await openCar(garage.cars.some((c) => c.id === wanted) ? wanted : garage.cars[0].id);
  garage.safe = (await navigator.storage.persist?.().catch(() => false)) ?? false;
  await measure();
  garage.ready = true;
  emit('garage');
}

/** Сводки всех машин: читаем car.json (он маленький), у «Истории» — только размер */
async function loadShelf() {
  const cars = [];
  for (const id of await store.list()) {
    try {
      const text = await store.read(id, 'car.json');
      const car = JSON.parse(text ?? 'null');
      if (car?.format !== CAR_FORMAT) continue;
      cars.push(summaryOf(id, car, { car: bytes(text), history: await store.size(id, FILES.history), runs: await store.size(id, FILES.runs) }));
    } catch { /* испорченную папку пропускаем */ }
  }
  garage.cars = cars.sort((a, b) => a.created - b.created);
}

async function openCar(id) {
  const { car, versions, runs: runList } = await readCar(id);
  const next = toCar(car, versions, runList);
  written.set(id, filesOf(next, car.created));
  seat(id, next);
}

/** Положить машину в гараж (в конец полки) — вернёт её id */
async function addCar(car) {
  const id = newId();
  const created = Date.now();
  const files = filesOf(car, created);
  await writeFiles(id, files);
  garage.cars.push(summaryOf(id, { ...car, created }, sizesOfFiles(files)));
  return id;
}

// ── действия полки ──

export const isFull = () => garage.cars.length >= MAX_CARS;

/** Пересесть в другую машину: нынешняя сначала записывается */
export async function switchCar(id) {
  if (id === garage.id || !garage.cars.some((c) => c.id === id)) return;
  await flush();
  await openCar(id);
}

/** Цвет, которого ещё нет в гараже */
const freeColor = () => CAR_COLORS.find((c) => !garage.cars.some((car) => car.profile.color === c)) ?? CAR_COLORS[garage.cars.length % CAR_COLORS.length];

/** Новая пустая машина — и сразу в неё */
export async function newCar() {
  if (isFull()) return;
  await flush();
  const id = await addCar(blankCar({ name: `Машина ${garage.cars.length + 1}`, color: freeColor() }));
  await openCar(id);
}

/** Копия выбранной машины вместе с мозгом и «Историей» — и сразу в неё */
export async function copyCar() {
  if (isFull()) return;
  await flush();
  const copy = /** @type {any} */ ({ ...pick(state, CAR_KEYS), runs: structuredClone(runs) });
  copy.profile.name = `${state.profile.name || 'Машина'} — копия`.slice(0, NAME_MAX);
  copy.profile.color = freeColor();
  const id = await addCar(copy);
  await openCar(id);
}

/** Удалить машину. Последнюю — нельзя; выбранную — сначала пересаживаемся в соседнюю */
export async function deleteCar(id) {
  if (garage.cars.length <= 1) return;
  if (id === garage.id) {
    const i = garage.cars.findIndex((c) => c.id === id);
    dirty = false; // её не записываем: всё равно удаляем
    await openCar(garage.cars[i + 1]?.id ?? garage.cars[i - 1].id);
  }
  await store.remove(id);
  if (disk) await disk.remove(id).catch(() => {});
  else if (folder) save(GONE, [...load(GONE, []), id]);
  written.delete(id);
  garage.cars = garage.cars.filter((c) => c.id !== id);
  await measure();
  emit('garage');
}

/** Файл выбранной машины вместе с «Историей»: { name — имя машины для имени файла, text } */
export async function exportCar() {
  await flush();
  const name = state.profile.name.trim() || 'машина';
  return { name, text: compactJson({ format: EXPORT_FORMAT, car: { ...pick(state, CAR_FIELDS) }, versions: state.versions, runs }) };
}

/**
 * Открыть машину из файла — и сразу в неё. Подходит файл гаража (с «Историей»)
 * и файл машины для гонки (car@3) — тогда в гараж приходят облик, сборка и мозг. Бросает Error.
 */
export async function importCar(text) {
  if (isFull()) throw new Error(`в гараже уже ${MAX_CARS} машин — удали лишнюю`);
  let file;
  try {
    file = JSON.parse(text);
  } catch {
    throw new Error('это не JSON');
  }
  let car;
  if (file?.format === EXPORT_FORMAT) {
    car = toCar(file.car, file.versions, file.runs);
  } else {
    const race = parseCarFile(file); // бросит понятную ошибку, если это не машина
    car = toCar({
      profile: { name: race.name, color: race.color ?? freeColor(), avatar: race.avatar ?? undefined },
      config: { sensors: race.sensors, hidden: race.sizes.slice(1, -1), think: race.thinkId },
      champion: race.brain, generation: file.trainedGenerations ?? 0, brainNote: 'из файла машины',
    });
  }
  await flush();
  const id = await addCar(car);
  await openCar(id);
}
