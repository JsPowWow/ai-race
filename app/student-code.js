// Код студентов: исходные модули из student/ + правки, сделанные на вкладке «Код».
import * as controls from '../student/controls.js';
import * as think from '../student/think.js';
import * as mutate from '../student/mutate.js';
import * as fitness from '../student/fitness.js';
import * as crossover from '../student/crossover.js';
import { SOURCES } from './generated/sources.js';
import { lerp, randomBetween, sigmoid, clamp } from '../engine/utils.js';
import { load, save, remove } from './storage.js';

export const FILES = [
  {
    id: 'controls', file: 'controls.js', title: 'Управление', required: ['handleKey'],
    task: 'Задание 1. Ручное управление. Стрелки уже работают. Добавь WASD, пробел — «ручник», Shift — аккуратный газ. Проверить можно на вкладке «Гараж».',
  },
  {
    id: 'think', file: 'think.js', title: 'Мозг', required: ['feedForward', 'thinkVariants'],
    task: 'Задание 2. Варианты «мозга». Готовые можно читать и сравнивать, свой пишется в thinkVariants.mine. Выбрать вариант — на вкладке «Гараж».',
  },
  {
    id: 'mutate', file: 'mutate.js', title: 'Мутация', required: ['mutate'],
    task: 'Задание 3. Как из лучшей машины сделать новое поколение. Сейчас каждое число тянется к случайному. Попробуй точечные мутации или маленький шум.',
  },
  {
    id: 'fitness', file: 'fitness.js', title: 'Фитнес', required: ['fitness'],
    task: 'Задание 4. За что хвалить машину. Сейчас — только за расстояние, поэтому машины учатся доезжать, но не спешить. На гонке побеждает самый быстрый.',
  },
  {
    id: 'crossover', file: 'crossover.js', title: 'Кроссовер', required: ['crossover'],
    task: 'Задание 5. Ребёнок от двух родителей. Включи «Родителей: 2» на вкладке «Трек» и сравни график с одним родителем. Сейчас каждое число берётся у мамы или у папы наугад. Попробуй среднее и «целыми нейронами».',
  },
];

const defaults = { controls, think, mutate, fitness, crossover };
/** Текущие рабочие модули (исходные или скомпилированные из правок) */
export const live = { ...defaults };

let evalOk = null;
export function evalAvailable() {
  if (evalOk === null) {
    try { evalOk = new Function('return 2 + 2')() === 4; } catch { evalOk = false; }
  }
  return evalOk;
}

export const originalSource = (id) => SOURCES[id] ?? '';
export const getSource = (id) => load(`code:${id}`, null) ?? originalSource(id);
export const isEdited = (id) => load(`code:${id}`, null) !== null;

/** Превратить текст ES-модуля в объект с его экспортами */
export function compileModule(src) {
  const names = [...src.matchAll(/export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);
  const body = src
    .replace(/^\s*import\s[^;]*;?[ \t]*$/gm, '')
    .replace(/export\s+(?=(?:async\s+)?(?:function|const|let|var|class)\b)/g, '');
  const factory = new Function('lerp', 'randomBetween', 'sigmoid', 'clamp', `"use strict";\n${body}\nreturn { ${names.join(', ')} };`);
  return factory(lerp, randomBetween, sigmoid, clamp);
}

export function applySource(id, src) {
  const meta = FILES.find((f) => f.id === id);
  const mod = compileModule(src);
  for (const name of meta.required) {
    if (mod[name] === undefined) throw new Error(`не найден export ${name}`);
  }
  live[id] = mod;
  if (src === originalSource(id)) remove(`code:${id}`);
  else save(`code:${id}`, src);
  return mod;
}

export function resetSource(id) {
  remove(`code:${id}`);
  live[id] = defaults[id];
}

/** При старте подхватить сохранённые правки */
export function restoreEdits() {
  const failed = [];
  if (!evalAvailable()) return failed;
  for (const { id } of FILES) {
    if (!isEdited(id)) continue;
    try { applySource(id, getSource(id)); } catch (e) { failed.push(`${id}: ${e.message}`); }
  }
  return failed;
}
