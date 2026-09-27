// Общее состояние приложения, его сохранение и простые события между вкладками.
import { DEFAULT_SENSORS } from '../engine/car.js';
import { layerSizes } from '../engine/brain.js';
import { CAR_COLORS } from '../engine/car-file.js';
import { load, save } from './storage.js';
import { live } from './student-code.js';

export { CAR_COLORS };

export const state = {
  tab: 'garage',
  /** Архитектура: сенсоры, скрытые слои, вариант «мозга» */
  config: load('config', null) ?? { sensors: { ...DEFAULT_SENSORS }, hidden: [6], think: live.think.DEFAULT_THINK ?? 'step' },
  /** Лучший мозг и история обучения */
  champion: load('champion', null),
  generation: load('generation', 0),
  history: load('history', []),
  hall: load('hall', []),
  handEdited: load('handEdited', false),
  /** Настройки вкладок */
  train: { trackId: 'warmup', seed: 'тренировка', traffic: 'all', parents: 1, population: 100, rate: 0.1, speed: '1', camera: 'fit', ...load('train', {}) },
  garage: { trackId: 'warmup', traffic: 'all', ...load('garage', {}) },
  race: { seed: 'урок-1', traffic: 'all', ...load('race', {}) },
  profile: { name: '', color: CAR_COLORS[0], ...load('profile', {}) },
};

const PERSISTED = ['config', 'champion', 'generation', 'hall', 'handEdited', 'train', 'garage', 'race', 'profile'];

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
export const sizesOf = (config = state.config) => layerSizes(config.sensors.count, config.hidden);
export const sameSizes = (a, b) => sizesOf(a).join() === sizesOf(b).join();

export const thinkVariant = (id) => live.think.thinkVariants?.[id] ?? live.think.thinkVariants?.step;
export const thinkFn = (id = state.config.think) => thinkVariant(id).think;

// ── события: вкладки узнают о переменах, не зная друг о друге ──
//  'champion' — сменился или поправлен лучший мозг ({ by })
//  'reset'    — обучение сброшено
//  'code'     — применён код студента (id файла)

const listeners = {};
export const on = (event, fn) => (listeners[event] ??= []).push(fn);
export const emit = (event, payload) => listeners[event]?.forEach((fn) => fn(payload));

// ── действия, общие для нескольких вкладок ──

export function setChampion(brain, { by, generation = state.generation, handEdited = false }) {
  state.champion = brain;
  state.generation = generation;
  state.handEdited = handEdited;
  persistSoon();
  emit('champion', { by });
}

export function resetProgress() {
  Object.assign(state, { champion: null, generation: 0, history: [], hall: [], handEdited: false });
  persist();
  emit('reset');
  emit('champion', { by: 'reset' });
}
