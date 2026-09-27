// Код студентов: исходные модули из student/ + правки, сделанные на вкладке «Код».
import * as controls from '../student/controls.js';
import * as think from '../student/think.js';
import * as mutate from '../student/mutate.js';
import * as fitness from '../student/fitness.js';
import * as crossover from '../student/crossover.js';
import { SOURCES } from './generated/sources.js';
import { compileSource } from '../engine/compile.js';
import * as acorn from 'acorn';
import { load, save, remove } from './storage.js';

export const FILES = [
  {
    id: 'controls', file: 'controls.js', title: 'Управление', required: ['handleKey'],
    task: 'Задание 1. Ручное управление. Стрелки уже работают. Добавь WASD, пробел — «ручник», Shift — аккуратный газ. Проверить можно на вкладке «Я учу».',
  },
  {
    id: 'think', file: 'think.js', title: 'Мозг', required: ['feedForward', 'thinkVariants'],
    task: 'Задание 2. Варианты «мозга». Готовые можно читать и сравнивать, свой пишется в thinkVariants.mine. Выбрать вариант — на «Я учу», в блоке «Сеть».',
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
    task: 'Задание 5. Ребёнок от двух родителей. Включи «Родителей: 2» на вкладке «Учится само» и сравни график с одним родителем. Сейчас каждое число берётся у мамы или у папы наугад. Попробуй среднее и «целыми нейронами».',
  },
];

const defaults = { controls, think, mutate, fitness, crossover };
/**
 * Текущие рабочие модули (исходные или скомпилированные из правок).
 * Студент может переписать файл как угодно, поэтому форма модулей заранее не известна — отсюда any.
 * @type {Record<keyof typeof defaults, any>}
 */
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

// ── как выполняется код студента ──
// Сама компиляция и её ограничения описаны в engine/compile.js.
// Здесь — то, что нужно редактору: синтаксис с номером строки и номер строки у ошибок выполнения.

/** Ошибка в коде студента с номером строки (если его удалось понять) */
export class CodeError extends Error {
  constructor(message, { line = null, kind = 'runtime' } = {}) {
    super(message);
    this.line = line;
    this.kind = kind; // 'syntax' | 'runtime' | 'contract'
  }
}

/** Синтаксис проверяем парсером: он, в отличие от new Function, знает номер строки */
function checkSyntax(src) {
  try {
    acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
  } catch (e) {
    throw new CodeError(e.message.replace(/\s*\(\d+:\d+\)$/, ''), { line: e.loc?.line ?? null, kind: 'syntax' });
  }
}

// Сколько строк new Function добавляет перед нашим кодом — узнаём опытным путём
const STACK_POSITION = /(?:<anonymous>|Function|eval)[^\n]*?:(\d+):\d+\)?\s*$/m;
const lineShift = (() => {
  try {
    new Function('"use strict";\nthrow new Error()')();
  } catch (e) {
    const line = +(e.stack?.match(STACK_POSITION)?.[1] ?? NaN);
    return Number.isFinite(line) ? line - 1 : null;
  }
  return null;
})();

/** Номер строки в файле студента, где случилась ошибка (или null) */
export function errorLine(error) {
  if (error instanceof CodeError) return error.line;
  if (lineShift === null || !error?.stack) return null;
  const line = +(error.stack.match(STACK_POSITION)?.[1] ?? NaN);
  return Number.isFinite(line) && line - lineShift >= 1 ? line - lineShift : null;
}

/** Превратить текст ES-модуля в объект с его экспортами */
export function compileModule(src) {
  checkSyntax(src);
  try {
    return compileSource(src);
  } catch (e) {
    throw new CodeError(e.message, { line: errorLine(e) });
  }
}

export function applySource(id, src) {
  const meta = FILES.find((f) => f.id === id);
  const mod = compileModule(src);
  for (const name of meta.required) {
    if (mod[name] === undefined) throw new CodeError(`не найден export ${name}`, { kind: 'contract' });
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

// ── защита от зависания ──
// Если сохранённый код зависает (например, while (true)), вкладка «умрёт» при каждой загрузке.
// Поэтому ставим флажок на время запуска: не снялся — значит, прошлый раз всё зависло.

const GUARD = 'codeStarting';
export const beginCodeStartup = () => save(GUARD, true);
export const endCodeStartup = () => remove(GUARD);

/** При старте подхватить сохранённые правки. Возвращает { failed, frozen } */
export function restoreEdits() {
  const failed = [];
  if (!evalAvailable()) return { failed, frozen: false };
  if (load(GUARD, false)) {
    for (const { id } of FILES) remove(`code:${id}`);
    endCodeStartup();
    return { failed, frozen: true };
  }
  beginCodeStartup(); // снимется в main.js, когда код отработает и пройдёт проверки
  for (const { id } of FILES) {
    if (!isEdited(id)) continue;
    try {
      applySource(id, getSource(id));
    } catch (e) {
      failed.push(`${id}: ${e.message}`);
    }
  }
  return { failed, frozen: false };
}
