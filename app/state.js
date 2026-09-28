// Общее состояние приложения, его сохранение и простые события между вкладками.
import { DEFAULT_SENSORS, rayCount } from '../engine/car.js';
import { layerSizes, checkBrain } from '../engine/brain.js';
import { CAR_COLORS } from '../engine/car-file.js';
import { DEFAULT_PARTS } from '../engine/recipes.js';
import { load, save, remove } from './storage.js';
import { live } from './student-code.js';

export { CAR_COLORS };

export const state = {
  tab: 'intro',
  /** Архитектура: сенсоры, скрытые слои, вариант «мозга» */
  config: load('config', null) ?? { sensors: { ...DEFAULT_SENSORS }, hidden: [6], think: live.think.DEFAULT_THINK ?? 'step' },
  /** Лучший мозг и история обучения */
  champion: load('champion', null),
  generation: load('generation', 0),
  history: load('history', []),
  hall: load('hall', []),
  handEdited: load('handEdited', false),
  /** Откуда текущий мозг — одной строкой для людей («рой, поколение 12», «обучен на 3 заездах»…) */
  brainNote: load('brainNote', ''),
  /** История мозга: прежние версии сохраняются сами — [{ id, at, brain, config, generation, handEdited, brainNote, pinned }] */
  versions: load('versions', null) ?? migrateLibrary(),
  /** Настройки вкладок */
  train: { trackId: 'warmup', seed: 'тренировка', traffic: 'all', parents: 2, parts: DEFAULT_PARTS, ownFitness: false, mutation: 'spot', population: 100, rate: 0.1, speed: '1', camera: 'fit', ...load('train', {}) },
  /** «Я учу»: трасса и машины (раньше это был «Гараж») */
  drive: { trackId: 'warmup', traffic: 'none', ...(load('drive', null) ?? load('garage', {})) },
  race: { seed: 'урок-1', traffic: 'all', ...load('race', {}) },
  profile: { name: '', color: CAR_COLORS[0], ...load('profile', {}) },
};

// Мозг, сохранённый до памяти (#4), другой формы: на нём машина не поедет. Начинаем с чистого листа.
if (state.champion && checkBrain(state.champion, layerSizes(rayCount(state.config.sensors), state.config.hidden))) {
  Object.assign(state, { champion: null, generation: 0, history: [], hall: [], handEdited: false, brainNote: '' });
}

const PERSISTED = ['config', 'champion', 'generation', 'hall', 'handEdited', 'brainNote', 'versions', 'train', 'drive', 'race', 'profile'];

/** Была библиотека по кнопке и один «прежний» мозг — теперь одна история: сохранённые вручную закрепляем */
function migrateLibrary() {
  const saved = (load('library', []) ?? []).map((e) => ({ ...e, brainNote: e.name || e.brainNote, at: e.savedAt ?? e.at, pinned: true }));
  const previous = load('previous', null);
  for (const key of ['library', 'previous', 'libraryId']) remove(key);
  return previous ? [{ id: 'prev', at: new Date().toISOString(), ...previous, pinned: false }, ...saved] : saved;
}

export function persist() {
  for (const key of PERSISTED) save(key, state[key]);
  save('history', state.history.slice(-300));
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
