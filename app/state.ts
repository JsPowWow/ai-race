// Общее состояние приложения, его сохранение и простые события между вкладками.
import { forEachSettled, isPlainObject } from '@reely/basics';
import { DEFAULT_SENSORS, rayCount, type Sensors } from '../engine/car.ts';
import { checkBrain, layerSizes, type Brain } from '../engine/brain.ts';
import { CAR_COLORS } from '../engine/car-file.ts';
import { DEFAULT_PARTS } from '../engine/recipes.ts';
import type { GenerationEntry } from '../engine/evolution.ts';
import type { TrafficLevel } from '../engine/traffic.ts';
import { load, save } from './storage.ts';
import { live, type ThinkVariant } from './student-code.ts';

export { CAR_COLORS };

/** Облик машины (login — только в старых данных: теперь он один на все машины) */
export type Profile = { name: string; color: string; avatar?: string; login?: string };
/** Форма машины: сенсоры, скрытые слои и вариант «мозга» (id из student/think.js) */
export type Shape = { sensors: Sensors; hidden: number[]; think: string };
/** Поколение роя на графике: на какой трассе и сколько было машин (у старых записей может не быть) */
export type HistoryEntry = GenerationEntry & { trackName?: string; population?: number };
/** Рекорд роя на трассе: мозг и чем он лучше других */
export type HallEntry = { gen: number; trackName: string; finished: boolean; ticks: number; progressPct: number; brain: Brain };
/** Снимок для «Машины времени»: лучший роя в поколении gen и форма машины тогда (чтобы он ехал как тогда) */
export type Moment = { gen: number; brain: Brain; config: Shape };
/** Версия мозга в «Истории» */
export type Version = {
  id: string; at: string; brain: Brain; config: Shape; generation: number;
  handEdited: boolean; brainNote: string; pinned: boolean;
};

/** Машина гаража: облик, сборка, мозг и всё, что копится, пока его учат */
export type CarData = {
  profile: Profile;
  /** Архитектура: сенсоры, скрытые слои, вариант «мозга» */
  config: Shape;
  /** Лучший мозг (null — ещё не обучен) и история обучения */
  champion: Brain | null;
  generation: number;
  history: HistoryEntry[];
  hall: HallEntry[];
  /** «Машина времени»: лучшие роя в поколениях 1, 5, 10, 25… */
  timeline: Moment[];
  handEdited: boolean;
  /** Откуда текущий мозг — одной строкой для людей («рой, поколение 12», «обучен на 3 заездах»…) */
  brainNote: string;
  /** «История» мозга: прежние версии сохраняются сами */
  versions: Version[];
};

/** Всё, что машина накопила, пока её учили: «Сбросить мозг» и мозг другой формы начинают это с чистого листа */
export const blankProgress = (): Pick<CarData, 'champion' | 'generation' | 'history' | 'hall' | 'timeline' | 'handEdited' | 'brainNote'> => ({
  champion: null, generation: 0, history: [], hall: [], timeline: [], handEdited: false, brainNote: '',
});

/** Пустая машина гаража */
export const blankCar = (profile: Partial<Profile> = {}): CarData => ({
  profile: { name: '', color: CAR_COLORS[0], ...profile },
  config: { sensors: { ...DEFAULT_SENSORS }, hidden: [6], think: live.think.DEFAULT_THINK ?? 'step' },
  ...blankProgress(),
  versions: [],
});

/** Снимок «Машины времени» из файла: поколение, форма и мозг этой формы. Испорченный — выбрасываем */
export const isMoment = (m: unknown): m is Moment =>
  isPlainObject(m) && Number.isInteger(m.gen) && isPlainObject(m.config) && isPlainObject(m.config.sensors) && Array.isArray(m.config.hidden) &&
  !checkBrain(m.brain, sizesOf(m.config as Shape));

/** Всё, что принадлежит машине: уезжает вместе с ней в гараж (app/garage.ts) */
export const CAR_KEYS = Object.keys(blankCar()) as (keyof CarData)[];

export type TabId = 'intro' | 'profile' | 'teach' | 'train' | 'code' | 'exam' | 'race' | 'final';

export type Speed = '1' | '4' | '16' | 'turbo';
export type Camera = 'fit' | 'follow';
/** Настройки роя («Учится само») */
export type TrainSettings = {
  /** учебная трасса, 'seed' — по seed, 'mix' — каждое поколение новая */
  trackId: string;
  seed: string;
  /** машины на трассе: без машин, попутные, попутные и встречные */
  traffic: TrafficLevel;
  parents: 1 | 2;
  /** галочки фитнеса (FITNESS_PARTS) */
  parts: string[];
  /** «Мой вариант»: фитнес из student/fitness.js вместо галочек */
  ownFitness: boolean;
  mutation: string;
  population: number;
  rate: number;
  speed: Speed;
  camera: Camera;
};

export const state: CarData & {
  tab: TabId;
  /** Настройки вкладок — общие для всех машин */
  train: TrainSettings;
  /** «Я учу»: трасса и машины (раньше это был «Гараж») */
  drive: { trackId: string; traffic: TrafficLevel };
  race: { seed: string; traffic: TrafficLevel };
  /** Логин GitHub для сдачи — один на все машины */
  login: string;
} = {
  tab: 'intro',
  /** Выбранная машина гаража: её поля лежат прямо здесь, гараж загрузит их при старте */
  ...blankCar(),
  train: {
    trackId: 'warmup', seed: 'тренировка', traffic: 'all', parents: 2, parts: DEFAULT_PARTS, ownFitness: false,
    mutation: 'spot', population: 100, rate: 0.1, speed: '1', camera: 'fit', ...load('train', {}),
  },
  drive: { trackId: 'warmup', traffic: 'none', ...(load('drive', null) ?? load('garage', {})) },
  race: { seed: 'урок-1', traffic: 'all', ...load('race', {}) },
  // раньше логин лежал в облике машины
  login: load<string | null>('login', null) ?? load<Partial<Profile>>('profile', {})?.login ?? '',
};

const SHARED = ['train', 'drive', 'race', 'login'] as const;
save('login', state.login); // гараж облик переносит, а логин должен остаться здесь

/** Сохранить: общие настройки — в localStorage, машину — гараж (он слушает событие 'save') */
export function persist(): void {
  for (const key of SHARED) save(key, state[key]);
  emit('save');
}

let saveTimer = 0;
export function persistSoon(): void {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 400);
}

// ── производные значения ──

/** Размеры слоёв: [входы, …скрытые, 4 выхода] */
export const sizesOf = (config: Pick<Shape, 'sensors' | 'hidden'> = state.config): number[] => layerSizes(rayCount(config.sensors), config.hidden);
export const sameSizes = (a: Shape, b: Shape): boolean => sizesOf(a).join() === sizesOf(b).join();

/** Как называть текущий мозг людям */
export const brainTitle = (): string => state.brainNote || 'свой мозг'; // номер поколения — про рой, а не про мозг: рой идёт, а мозг меняют «Взять»

export type { ThinkVariant };
/** Варианты «мозга» из think.js (студент мог их сломать — тогда пусто) */
export const thinkVariants = (): Record<string, ThinkVariant> => live.think.thinkVariants ?? {};
export const thinkVariant = (id: string): ThinkVariant | undefined => thinkVariants()[id] ?? thinkVariants().step;
export const thinkFn = (id = state.config.think): ThinkVariant['think'] => {
  const variant = thinkVariant(id);
  if (!variant) throw new Error('в think.js нет ни одного варианта мозга');
  return variant.think;
};

// ── события: вкладки узнают о переменах, не зная друг о друге ──

/** Что каждое событие значит и что оно несёт */
type Events = {
  /** Сменился или поправлен лучший мозг: кто это сделал */
  champion: { by: string };
  /** Обучение сброшено */
  reset: undefined;
  /** Рой закончил поколение: график, рекорды и номер поколения поменялись (мозг — нет, его берут «Взять») */
  generation: undefined;
  /** Применён код студента: id файла */
  code: string;
  /** Поменялись сенсоры, слои или вариант мозга */
  config: undefined;
  /** Поменялась «История» мозга */
  library: undefined;
  /** Пересели в другую машину гаража (все события выше тоже пришли) */
  car: undefined;
  /** Поменялся гараж: машины, их размеры, место */
  garage: undefined;
  /** Что-то поменялось в машине: гаражу пора записать её */
  save: undefined;
  /** Ученик сделал шаг урока: 'exam', 'race:start', 'code:think'… (см. app/lessons.ts) */
  did: string;
};
export type AppEvent = keyof Events;

type Listener = (payload: unknown) => void;
const listeners = new Map<AppEvent, Listener[]>();
export function on<E extends AppEvent>(event: E, fn: (payload: Events[E]) => void): void {
  listeners.set(event, [...(listeners.get(event) ?? []), fn as Listener]);
}
/**
 * Разослать событие. Что оно несёт — в Events: у 'champion' — кто, у 'code' — id файла, у остальных ничего.
 * Если один слушатель упал, остальные всё равно узнают о событии: ошибка вкладки не ломает другие
 */
export function emit<E extends AppEvent>(event: E, ...[payload]: Events[E] extends undefined ? [] : [Events[E]]): void {
  forEachSettled(listeners.get(event) ?? [], (fn) => fn(payload), `событие «${event}»: упали слушатели`);
}

// ── действия, общие для нескольких вкладок ──

const NOTES: Record<string, (gen: number) => string> = {
  train: (gen) => `рой, поколение ${gen}`,
  editor: () => 'поправлен руками',
  hall: (gen) => `рекорд роя, поколение ${gen}`,
};

/** Поставить новый лучший мозг той же формы. by, generation… — кто и как его получил */
export function setChampion(brain: Brain, { by, generation = state.generation, handEdited = false, note }: { by: string; generation?: number; handEdited?: boolean; note?: string }): void {
  state.champion = brain;
  state.generation = generation;
  state.handEdited = handEdited;
  state.brainNote = note ?? NOTES[by]?.(generation) ?? state.brainNote;
  persistSoon();
  emit('champion', { by });
}

export function resetProgress(): void {
  Object.assign(state, blankProgress());
  persist();
  emit('reset');
  emit('champion', { by: 'reset' });
}
