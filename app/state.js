// Общее состояние приложения, его сохранение и простые события между вкладками.
import { DEFAULT_SENSORS, rayCount } from '../engine/car.ts';
import { layerSizes } from '../engine/brain.ts';
import { CAR_COLORS } from '../engine/car-file.ts';
import { DEFAULT_PARTS } from '../engine/recipes.ts';
import { load, save } from './storage.js';
import { live } from './student-code.js';

export { CAR_COLORS };

/** @typedef {{ name: string, color: string, avatar?: string, login?: string }} Profile облик машины (login — только в старых данных) */

/** Пустая машина гаража: облик, сборка, мозг и всё, что копится, пока его учат */
export const blankCar = (/** @type {Partial<Profile>} */ profile = {}) => ({
  profile: /** @type {Profile} */ ({ name: '', color: CAR_COLORS[0], ...profile }),
  /** Архитектура: сенсоры, скрытые слои, вариант «мозга» */
  config: { sensors: { ...DEFAULT_SENSORS }, hidden: [6], think: live.think.DEFAULT_THINK ?? 'step' },
  /** Лучший мозг и история обучения */
  champion: null,
  generation: 0,
  history: [],
  hall: [],
  handEdited: false,
  /** Откуда текущий мозг — одной строкой для людей («рой, поколение 12», «обучен на 3 заездах»…) */
  brainNote: '',
  /** История мозга: прежние версии сохраняются сами — [{ id, at, brain, config, generation, handEdited, brainNote, pinned }] */
  versions: [],
});

/** Всё, что принадлежит машине: уезжает вместе с ней в гараж (app/garage.js) */
export const CAR_KEYS = /** @type {(keyof ReturnType<typeof blankCar>)[]} */ (Object.keys(blankCar()));

export const state = {
  tab: 'intro',
  /** Выбранная машина гаража: её поля лежат прямо здесь, гараж загрузит их при старте */
  ...blankCar(),
  /** Настройки вкладок — общие для всех машин */
  train: { trackId: 'warmup', seed: 'тренировка', traffic: 'all', parents: 2, parts: DEFAULT_PARTS, ownFitness: false, mutation: 'spot', population: 100, rate: 0.1, speed: '1', camera: 'fit', ...load('train', {}) },
  /** «Я учу»: трасса и машины (раньше это был «Гараж») */
  drive: { trackId: 'warmup', traffic: 'none', ...(load('drive', null) ?? load('garage', {})) },
  race: { seed: 'урок-1', traffic: 'all', ...load('race', {}) },
  /** Логин GitHub для сдачи — один на все машины (раньше лежал в облике) */
  login: load('login', null) ?? load('profile', {})?.login ?? '',
};

const SHARED = ['train', 'drive', 'race', 'login'];
save('login', state.login); // раньше логин лежал в облике машины — гараж облик переносит, а логин должен остаться здесь

/** Сохранить: общие настройки — в localStorage, машину — гараж (он слушает событие 'save') */
export function persist() {
  for (const key of SHARED) save(key, state[key]);
  emit('save');
}

let saveTimer = 0;
export function persistSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persist, 400);
}

// ── производные значения ──

/** Размеры слоёв: [входы, …скрытые, 4 выхода] */
export const sizesOf = (config = state.config) => layerSizes(rayCount(config.sensors), config.hidden);
export const sameSizes = (a, b) => sizesOf(a).join() === sizesOf(b).join();

/** Как называть текущий мозг людям */
export const brainTitle = () => state.brainNote || (state.generation ? `рой, поколение ${state.generation}` : 'свой мозг');

export const thinkVariant = (id) => live.think.thinkVariants?.[id] ?? live.think.thinkVariants?.step;
export const thinkFn = (id = state.config.think) => thinkVariant(id).think;

// ── события: вкладки узнают о переменах, не зная друг о друге ──
//  'champion' — сменился или поправлен лучший мозг ({ by })
//  'reset'    — обучение сброшено
//  'code'     — применён код студента (id файла)
//  'config'   — поменялись сенсоры, слои или вариант мозга
//  'library'  — поменялась история мозга
//  'car'      — пересели в другую машину гаража (всё выше тоже пришло)
//  'garage'   — поменялся гараж: машины, их размеры, место
//  'save'     — что-то поменялось в машине: гаражу пора записать её

const listeners = {};
export const on = (event, fn) => (listeners[event] ??= []).push(fn);
export const emit = (event, payload) => listeners[event]?.forEach((fn) => fn(payload));

// ── действия, общие для нескольких вкладок ──

const NOTES = {
  train: (gen) => `рой, поколение ${gen}`,
  editor: () => 'поправлен руками',
  hall: (gen) => `рекорд роя, поколение ${gen}`,
};

/**
 * Поставить новый лучший мозг той же формы.
 * @param {object} brain
 * @param {{ by: string, generation?: number, handEdited?: boolean, note?: string }} how кто и как его получил
 */
export function setChampion(brain, { by, generation = state.generation, handEdited = false, note }) {
  state.champion = brain;
  state.generation = generation;
  state.handEdited = handEdited;
  state.brainNote = note ?? NOTES[by]?.(generation) ?? state.brainNote;
  persistSoon();
  emit('champion', { by });
}

export function resetProgress() {
  Object.assign(state, { champion: null, generation: 0, history: [], hall: [], handEdited: false, brainNote: '' });
  persist();
  emit('reset');
  emit('champion', { by: 'reset' });
}
