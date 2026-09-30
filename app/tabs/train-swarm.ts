// Рой «Учится само»: поколения, отбор, рекорды. Без разметки — её рисуют train-*.tsx по сигналам отсюда.
// Рой учится в фоне на любой вкладке: updateTraining() зовёт кадровый цикл app/main.ts.
import { batch, effect, signal, untracked } from '@reely/dommy';
import { TRAINING_TRACKS, getTrainingTrack, forksPassed, withCoins } from '../../engine/track.ts';
import type { Track } from '../../engine/track.ts';
import type { Car, CarReport } from '../../engine/car.ts';
import { cloneBrain } from '../../engine/brain.ts';
import type { Brain } from '../../engine/brain.ts';
import { Evolution } from '../../engine/evolution.ts';
import type { EvolutionOptions, Rival } from '../../engine/evolution.ts';
import { MUTATIONS, crossover, fitnessOf } from '../../engine/recipes.ts';
import { withTraffic } from '../../engine/traffic.ts';
import { state, type HistoryEntry, type HallEntry, persist, persistSoon, sizesOf, thinkFn, on, emit } from '../state.ts';
import { propose } from '../variants.ts';
import { live, errorLine } from '../student-code.ts';
import { seedTrack } from '../tracks.ts';
import { fromEvents } from '../signals.ts';
import { train, setTrain } from './train-settings.ts';
import type { TrainSettings } from './train-settings.ts';
import { rivals } from './train-rivals.tsx';

/** Сколько миллисекунд кадра рой может думать: остальное — на рисование, чтобы страница не тормозила */
const FRAME_BUDGET_MS = 22;
/** Сколько поколений держим на графике */
const HISTORY_KEEP = 300;
/** Сколько рекордов роя храним (у каждого — целый мозг, а localStorage маленький) */
const HALL_SIZE = 8;

/** Строка графика — то, что вернул движок, плюс что нужно странице: название трассы и сколько машин ехало */
/** Рекорд роя: лучший результат на трассе и мозг, который его показал */

// ── что происходит сейчас ──

/** Идущая эволюция (null — ещё не запускали или сбросили) */
const evolution = signal<Evolution | null>(null);
const running = signal(false);
/** Трасса текущего поколения */
const track = signal<Track | null>(null);
/** Машины, выбранные щелчком в родители */
const picked = signal<readonly Car[]>([]);
/** Лидер прошлого поколения: сколько раз заехал в медленную зону на развилке */
const slowdowns = signal(0);
/** Ошибка в коде студента: этого поколения — или прошлого, пока новое её ещё не повторило */
const studentError = signal('');
let lastGenerationError = '';
/** Сколько поколений закончилось на глазах (×1 и ×4): «Рой сейчас» по нему подсвечивает отбор и мутацию */
const shownEnds = signal(0);

export const isRunning = (): boolean => running.value;
export const isStarted = (): boolean => evolution.value !== null;
export const currentSwarm = (): Evolution | null => evolution.peek();
export const currentTrack = (): Track | null => track.value;
export const pickedCars = (): readonly Car[] => picked.value;
export const leaderSlowdowns = (): number => slowdowns.value;
export const errorText = (): string => studentError.value;
export const generationsShown = (): number => shownEnds.value;

/** Что рой копит в машине. state.js пока на JS, и у пустых массивов там тип never[] — описываем сами */

/**
 * Итоги роя в машине: график, рекорды, номер поколения и есть ли мозг вообще. Меняются в конце поколения
 * (событие generation) и снаружи: сброс, другая машина гаража, «Взять».
 */
export const results = fromEvents(['generation', 'champion', 'reset', 'car'], () => ({
  history: state.history,
  hall: state.hall,
  generation: state.generation,
  trained: !!state.champion,
}));

// ── трасса и рецепт ──

/** «Микс»: три поколения из пяти — учебные трассы по очереди, два — новые, по seed */
const mixTrack = (gen: number): Track =>
  gen % 5 < 3 ? getTrainingTrack(TRAINING_TRACKS[gen % 5].id) : seedTrack(`микс-${gen}`);

/** Трасса поколения gen: у каждого поколения судьи бросают монетку по-своему (знаки на развилках) */
export function trackForGeneration(gen: number, { trackId, seed, traffic }: TrainSettings = train()): Track {
  const base: Track = trackId === 'seed' ? seedTrack(seed || 'тренировка') : trackId === 'mix' ? mixTrack(gen) : getTrainingTrack(trackId);
  return withCoins(withTraffic(base, traffic), gen);
}

/** Мутация по id; неизвестная (например, из старых настроек) — «Точечная» */
export const mutationId = (id: string): string => (id in MUTATIONS ? id : 'spot');

/** Твой мозг едет рядом с роем, как соперник: видно, обогнал ли его рой. В отбор он не идёт */
const yours = new WeakSet<Rival>();
export const isYours = (rival: Rival): boolean => yours.has(rival);
function yourRival(): Rival[] {
  if (!state.champion) return [];
  const rival: Rival = { brain: state.champion, think: thinkFn(), sensors: { ...state.config.sensors } };
  yours.add(rival);
  return [rival];
}

/** Рецепт и настройки роя — берутся заново с каждого поколения: новый рецепт действует со следующего */
function recipe(): Omit<EvolutionOptions, 'parent' | 'parent2'> {
  const t = train();
  return {
    sizes: sizesOf(),
    sensors: { ...state.config.sensors },
    think: thinkFn(),
    mutate: MUTATIONS[mutationId(t.mutation)].mutate,
    // «Мой вариант» — функция fitness из student/fitness.js, иначе — из галочек
    fitness: t.ownFitness ? live.fitness.fitness : fitnessOf(t.parts),
    crossover,
    parents: t.parents,
    population: t.population,
    rate: t.rate,
    rivals: [...yourRival(), ...rivals.peek().map((r) => r.rival)],
  };
}

// ── поколения ──

/** Ошибка в коде студента, которую рой поймал в этом поколении, — словами для человека */
function errorOf(evo: Evolution): string {
  const [error] = evo.errors;
  if (!error) return '';
  const line = errorLine(evo.lastError);
  return `Ошибка в коде студента${line ? ` (строка ${line})` : ''}: ${error}. Машины едут, но результат может быть странным. Подробности — на вкладке «Код».`;
}

function startGeneration(evo: Evolution): void {
  Object.assign(evo, recipe(), { generation: state.generation });
  const next = trackForGeneration(state.generation);
  evo.spawn(next);
  batch(() => {
    track.value = next;
    picked.value = [];
    studentError.value = errorOf(evo) || lastGenerationError;
  });
}

/** Рекорды роя: лучший результат на каждой трассе — один. Побил свой рекорд — прежний уходит */
function addToHall(row: { gen: number; trackName: string }, report: CarReport, brain: Brain): void {
  const candidate: HallEntry = {
    gen: row.gen, trackName: row.trackName, finished: report.finished, ticks: report.ticks, progressPct: report.progressPct, brain: cloneBrain(brain),
  };
  const beats = (a: HallEntry, b: HallEntry) =>
    a.finished !== b.finished ? a.finished : a.finished ? a.ticks < b.ticks : a.progressPct > b.progressPct + 0.5;
  const hall = state.hall;
  const rival = hall.find((h) => h.trackName === row.trackName);
  if (rival && !beats(candidate, rival)) return;
  state.hall = [candidate, ...hall.filter((h) => h !== rival)].slice(0, HALL_SIZE);
}

// В турбо поколение длится доли секунды, а сохранять весь мозг и историю каждый раз дорого: не чаще раза в 2 с
let savedAt = 0;
function saveOften(): void {
  if (performance.now() - savedAt < 2000) return persistSoon();
  savedAt = performance.now();
  persist();
}

/** На трассе есть развилка со знаком */
export const isMaze = (t: Track | null): boolean => (t?.islands.length ?? 0) > 0;

/**
 * Поколение закончилось (или его закончили кнопкой): отбор и сразу следующее.
 * Лучший роя — новый вариант: контрольный заезд против твоего мозга, и если он лучше — карточка «Взять» (app/variants.ts)
 */
export function endGeneration(): void {
  const evo = evolution.peek();
  const now = track.peek();
  if (!evo || !now) return;
  batch(() => {
    const { entry, report, parentCar } = evo.evaluate([...picked.peek()]);
    const best = evo.parent;
    if (!best) throw new Error('после отбора у роя нет родителя');
    const row = { ...entry, trackName: now.name, population: evo.cars.length } satisfies HistoryEntry;
    state.history = [...state.history, row].slice(-HISTORY_KEEP);
    addToHall(row, report, best); // до setChampion: по его событию страница перечитает и график, и рекорды
    slowdowns.value = parentCar.slowdowns;
    lastGenerationError = errorOf(evo);
    state.generation = evo.generation;
    emit('generation');
    const brain = cloneBrain(best);
    propose({ brain, config: state.config, by: 'train', note: `рой, поколение ${evo.generation}` }, trackForGeneration(0), `поколение ${evo.generation}`);
    if (now.id === 'snake') emit('did', 'train:snake'); // шаг 1 урока 2 — рой учится на «Змейке»
    if (isMaze(now) && forksPassed(now, parentCar.bestS) >= 2) emit('did', 'train:maze'); // шаг 3 — рой проехал развилку хотя бы на двух кругах
    saveOften();
    if (train().speed === '1' || train().speed === '4') shownEnds.value++;
    startGeneration(evo);
  });
}

/** Шаг роя в кадре. Обучение идёт в фоне на любой вкладке */
export function updateTraining(): void {
  const evo = evolution.peek();
  if (!running.peek() || !evo) return;
  const { speed } = train();
  const turbo = speed === 'turbo';
  const started = performance.now();
  for (let n = turbo ? Infinity : +speed; n > 0 && performance.now() - started < FRAME_BUDGET_MS; n--) {
    if (evo.step() > 0) continue;
    endGeneration();
    if (!turbo) break; // на ×1…×16 конец поколения видно: новое начнётся со следующего кадра
  }
  studentError.value = errorOf(evo) || lastGenerationError; // ошибка в think() всплывает на ходу
}

// ── кнопки ──

function setRunning(on: boolean): void {
  if (on && !evolution.peek()) {
    const evo = new Evolution({ ...recipe(), parent: state.champion && cloneBrain(state.champion) });
    evolution.value = evo;
    startGeneration(evo);
  }
  running.value = on;
}

/** «Старт» / «Пауза» / «Продолжить» */
export const toggleRunning = (): void => setRunning(!running.peek());

/** Сменили трассу или машины. На паузе новое поколение сразу встаёт на новую трассу — видно, что выбрал */
export function setTrackSetting<K extends 'trackId' | 'traffic' | 'seed'>(key: K, value: TrainSettings[K]): void {
  setTrain(key, value);
  const evo = evolution.peek();
  if (evo && !running.peek()) startGeneration(evo);
}

// Соперники поменялись. На паузе — сразу на старт с ними, на ходу — со следующего поколения (как рецепт)
effect(() => {
  void rivals.value;
  untracked(() => {
    const evo = evolution.peek();
    if (evo && !running.peek()) startGeneration(evo);
  });
});

/** Сколько родителей; выбранных щелчком машин не больше, чем родителей */
export function setParents(parents: 1 | 2): void {
  setTrain('parents', parents);
  picked.update((list) => list.slice(-parents));
}

/** Щелчок по машине: выбрать её в родители. Повторный щелчок снимает выбор */
export function togglePick(car: Car): void {
  const now = picked.peek();
  picked.value = now.includes(car) ? now.filter((c) => c !== car) : [...now, car].slice(-train().parents);
}
export const clearPicked = (): void => {
  picked.value = [];
};

// ── реакция на другие вкладки ──

on('champion', ({ by }: { by: string }) => {
  const evo = evolution.peek();
  if (by === 'train' || !evo || !state.champion) return;
  // взяли вариант «Я учу», поправили руками, вернули из «Истории» или взяли рекорд — рой продолжает с него
  evo.startFrom(state.champion);
  startGeneration(evo);
});
on('reset', () => {
  lastGenerationError = '';
  batch(() => {
    evolution.value = null;
    running.value = false;
    track.value = null;
    picked.value = [];
    slowdowns.value = 0;
    studentError.value = '';
  });
});
