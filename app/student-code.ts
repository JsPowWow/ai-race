// Код студентов: исходные модули из student/ + правки, сделанные на вкладке «Код».
import * as controls from '../student/controls.js';
import * as think from '../student/think.js';
import * as mutate from '../student/mutate.js';
import * as fitness from '../student/fitness.js';
import * as crossover from '../student/crossover.js';
import { SOURCES } from './generated/sources.js';
import { compileSource, type StudentModule } from '../engine/compile.ts';
import type { Brain } from '../engine/brain.ts';
import type { Controls } from '../engine/car.ts';
import type { Mutate } from '../engine/recipes.ts';
import type { Fitness } from '../engine/evolution.ts';
import * as acorn from 'acorn';
import { load, save, remove } from './storage.ts';
import { messageOf } from '../engine/errors.ts';

/** Вариант «мозга» из student/think.js: название, подсказка и сама функция */
export type ThinkVariant = { title?: string; hint?: string; think: (inputs: number[], brain: Brain) => number[] };

/**
 * Что сайт берёт из файлов студента. Студент может переписать файл как угодно — поэтому
 * обязательные экспорты (required ниже) проверяет applySource, а вызовы обёрнуты в try там, где их зовут.
 */
export type StudentFiles = {
  controls: { handleKey(key: string, down: boolean, controls: Controls): unknown };
  think: {
    /** lastTrace — что посчитал каждый слой в последнем вызове: его рисует табло мозга */
    feedForward: ((inputs: number[], brain: Brain, activate?: (x: number) => number) => number[]) & { lastTrace?: number[][] | null };
    thinkVariants: Record<string, ThinkVariant>;
    DEFAULT_THINK?: string;
  };
  mutate: { mutate: Mutate };
  fitness: { fitness: Fitness };
  /** должен вернуть мозг той же формы; рой и «Гонка» всё равно проверяют, что вернулось */
  crossover: { crossover(mom: Brain, dad: Brain): Brain };
};
export type FileId = keyof StudentFiles;
/** Файл студента на вкладке «Код»: required — что он обязан экспортировать, task — задание */
export type StudentFile = { id: FileId; file: string; title: string; required: string[]; task: string };

// Порядок — как в уроке 3: фитнес, мутация, свой мозг; управление и кроссовер — бонус
export const FILES: StudentFile[] = [
  {
    id: 'fitness', file: 'fitness.js', title: 'Фитнес', required: ['fitness'],
    task: 'Шаг 1. За что хвалить машину. Сейчас — только за расстояние, поэтому машины учатся доезжать, но не спешить. На гонке побеждает самый быстрый: добавь бонус за финиш (car.finished) и за скорость (меньше car.ticks — лучше).',
  },
  {
    id: 'mutate', file: 'mutate.js', title: 'Мутация', required: ['mutate'],
    task: 'Шаг 2. Как из лучшей машины сделать новое поколение. Сейчас каждое число тянется к случайному. Попробуй точечные мутации или маленький шум.',
  },
  {
    id: 'think', file: 'think.js', title: 'Мозг', required: ['feedForward', 'thinkVariants'],
    task: 'Шаг 3. Варианты «мозга». Готовые можно читать и сравнивать, свой пишется в thinkVariants.mine. Выбрать вариант — на «Профиле» или в «Рецепте роя».',
  },
  {
    id: 'controls', file: 'controls.js', title: 'Управление', required: ['handleKey'],
    task: 'Бонус. Ручное управление. Стрелки уже работают. Добавь WASD, пробел — «ручник», Shift — аккуратный газ. Проверить можно на вкладке «Я учу».',
  },
  {
    id: 'crossover', file: 'crossover.js', title: 'Кроссовер', required: ['crossover'],
    task: 'Бонус. Ребёнок от двух родителей. Включи «Родителей: 2» на вкладке «Учится само» и сравни график с одним родителем. Сейчас каждое число берётся у мамы или у папы наугад. Попробуй среднее и «целыми нейронами».',
  },
];

// student/ — обычный JS без типов: форму его экспортов описывает StudentFiles выше
const defaults = { controls, think, mutate, fitness, crossover } as unknown as StudentFiles;
/** Текущие рабочие модули (исходные или скомпилированные из правок) */
export const live: StudentFiles = { ...defaults };

let evalOk: boolean | null = null;
/** Можно ли на этой странице запускать код из текста (new Function): строгая CSP запрещает */
export function evalAvailable(): boolean {
  if (evalOk === null) {
    try { evalOk = new Function('return 2 + 2')() === 4; } catch { evalOk = false; }
  }
  return evalOk;
}

export const originalSource = (id: FileId): string => (SOURCES as Record<string, string>)[id] ?? '';
export const getSource = (id: FileId): string => load<string | null>(`code:${id}`, null) ?? originalSource(id);
export const isEdited = (id: FileId): boolean => load<string | null>(`code:${id}`, null) !== null;

// ── как выполняется код студента ──
// Сама компиляция и её ограничения описаны в engine/compile.ts.
// Здесь — то, что нужно редактору: синтаксис с номером строки и номер строки у ошибок выполнения.

/** Ошибка в коде студента с номером строки (если его удалось понять) */
export class CodeError extends Error {
  line: number | null;
  /** syntax — не разобрался текст, runtime — упало при запуске, contract — нет нужного export */
  kind: 'syntax' | 'runtime' | 'contract';
  constructor(message: string, { line = null, kind = 'runtime' }: { line?: number | null; kind?: CodeError['kind'] } = {}) {
    super(message);
    this.line = line;
    this.kind = kind;
  }
}


/** Синтаксис проверяем парсером: он, в отличие от new Function, знает номер строки */
function checkSyntax(src: string): void {
  try {
    acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
  } catch (e) {
    const line = e instanceof SyntaxError && 'loc' in e ? (e.loc as { line?: number } | undefined)?.line ?? null : null; // acorn кладёт место ошибки в loc
    throw new CodeError(messageOf(e).replace(/\s*\(\d+:\d+\)$/, ''), { line, kind: 'syntax' });
  }
}

// Сколько строк new Function добавляет перед нашим кодом — узнаём опытным путём
const STACK_POSITION = /(?:<anonymous>|Function|eval)[^\n]*?:(\d+):\d+\)?\s*$/m;
const lineShift = (() => {
  try {
    new Function('"use strict";\nthrow new Error()')();
  } catch (e) {
    const line = +((e instanceof Error ? e.stack : '')?.match(STACK_POSITION)?.[1] ?? NaN);
    return Number.isFinite(line) ? line - 1 : null;
  }
  return null;
})();

/** Номер строки в файле студента, где случилась ошибка (или null) */
export function errorLine(error: unknown): number | null {
  if (error instanceof CodeError) return error.line;
  if (lineShift === null || !(error instanceof Error) || !error.stack) return null;
  const line = +(error.stack.match(STACK_POSITION)?.[1] ?? NaN);
  return Number.isFinite(line) && line - lineShift >= 1 ? line - lineShift : null;
}

/** Превратить текст ES-модуля в объект с его экспортами */
export function compileModule(src: string): StudentModule {
  checkSyntax(src);
  try {
    return compileSource(src);
  } catch (e) {
    throw new CodeError(messageOf(e), { line: errorLine(e) });
  }
}

export function applySource<Id extends FileId>(id: Id, src: string): StudentFiles[Id] {
  const meta = FILES.find((f) => f.id === id);
  const mod = compileModule(src);
  for (const name of meta?.required ?? []) {
    if (mod[name] === undefined) throw new CodeError(`не найден export ${name}`, { kind: 'contract' });
  }
  live[id] = mod as StudentFiles[Id]; // обязательные экспорты на месте — проверили выше
  if (src === originalSource(id)) remove(`code:${id}`);
  else save(`code:${id}`, src);
  return live[id];
}

export function resetSource(id: FileId): void {
  remove(`code:${id}`);
  Object.assign(live, { [id]: defaults[id] });
}

// ── защита от зависания ──
// Если сохранённый код зависает (например, while (true)), вкладка «умрёт» при каждой загрузке.
// Поэтому ставим флажок на время запуска: не снялся — значит, прошлый раз всё зависло.

const GUARD = 'codeStarting';
export const beginCodeStartup = () => save(GUARD, true);
export const endCodeStartup = () => remove(GUARD);

/** При старте подхватить сохранённые правки. Возвращает { failed, frozen } */
export function restoreEdits(): { failed: string[]; frozen: boolean } {
  const failed: string[] = [];
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
      failed.push(`${id}: ${messageOf(e)}`);
    }
  }
  return { failed, frozen: false };
}
