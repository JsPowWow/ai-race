// «Я учу», обучение на заездах: мозг учится повторять за тобой — по эпохе за кадр, чтобы было видно,
// как падает ошибка. Учёба всегда продолжает текущий мозг; готовый ставим через setBrain(), прежний уходит в «Историю».
import { signal, effect, canvas } from '@reely/dommy';
import { createBrain, cloneBrain, checkBrain } from '../../engine/brain.ts';
import type { Brain } from '../../engine/brain.ts';
import { trainEpoch, agreement, TEACH_THINK } from '../../engine/imitation.ts';
import type { Sample } from '../../engine/imitation.ts';
import { drawSeries } from '../../engine/netviz.ts';
import { state, sizesOf, brainTitle, thinkVariant, on } from '../state.js';
import { load, save } from '../storage.js';
import { live } from '../student-code.js';
import { trainingSamples } from '../runs.js';
import { setBrain } from '../library.js';
import { fromEvents } from '../signals.ts';
import { plural } from './teach-words.ts';

/** Меньше примеров — учить не на чем: это пара заездов по «Разминке» */
export const MIN_SAMPLES = 200;

/** Сколько эпох и какой шаг — помним между заходами */
type Settings = { epochs: number; rate: number };
const settings = signal<Settings>({ epochs: 20, rate: 0.05, ...load('teach', {}) });
function change(next: Partial<Settings>): void {
  settings.value = { ...settings.peek(), ...next };
  save('teach', settings.peek());
}
const RATES = [0.01, 0.05, 0.2, 1];

/** Идёт обучение: чему учим (копию мозга — на странице он не меняется, пока не доучится) и на чём */
type Lesson = { brain: Brain; samples: Sample[]; total: number; runs: number; fresh: boolean; before: string };
export const lesson = signal<Lesson | null>(null);
/** Ошибка после каждой эпохи — для графика; после обучения остаётся на экране */
const losses = signal<readonly number[]>([]);
/** Эпох уже прошло */
export const epoch = () => losses.value.length;
/** Почему обучение остановилось, не доучившись ('' — не останавливалось) */
export const stopped = signal('');
/** «Как учится» раскрыт */
const open = signal(false);

// ── вариант «думания»: обучение на примерах работает только с «Плавным» (см. engine/imitation.ts) ──

const think = fromEvents(['config', 'car', 'code'], () => ({ now: state.config.think, can: !!live.think.thinkVariants?.[TEACH_THINK] }));
const titleOf = (id: string) => thinkVariant(id)?.title ?? id;
/** В think.js есть «Плавный» — без него учиться на примерах нельзя */
export const canLearn = () => think().can;
/** Учёба сменит вариант мозга? Тогда скажем об этом заранее, а не молча */
export function thinkSwitch(): string {
  if (!think().can) return `В think.js нет варианта «${TEACH_THINK}» — на примерах учится только он. Верни его на вкладке «Код».`;
  if (think().now === TEACH_THINK) return '';
  return `Учёба переключит «Как думает» с «${titleOf(think().now)}» на «${titleOf(TEACH_THINK)}»: на примерах учится только плавный мозг.`;
}

// ── обучение ──

/** Начать учиться на отмеченных заездах. Нет мозга — начинаем со случайных весов */
export function startTraining(): void {
  const { samples, runs } = trainingSamples(sizesOf()[0]);
  if (samples.length < MIN_SAMPLES || !canLearn()) return;
  lesson.value = {
    brain: state.champion ? cloneBrain(state.champion) : createBrain(sizesOf()),
    samples, total: settings.peek().epochs, runs: runs.length,
    fresh: !state.champion,
    before: brainTitle(),
  };
  losses.value = [];
  stopped.value = '';
  open.value = true;
}

function stop(why: string): void {
  if (!lesson.peek()) return;
  lesson.value = null;
  stopped.value = why;
}
// Пока учился, пересели в другую машину или поменяли форму сети (в «Профиле») — выученное сюда уже не подходит
on('car', () => stop('Обучение остановлено: ты пересел в другую машину.'));
on('config', () => {
  const now = lesson.peek();
  if (now && checkBrain(now.brain, sizesOf())) stop('Обучение остановлено: поменялась форма сети, выученное к ней не подходит.');
});

/**
 * Одна эпоха (зовёт кадровый цикл, пока идёт обучение). Доучился — ставим мозг
 * и возвращаем текст для баннера; иначе null.
 */
export function trainStep(): string | null {
  const now = lesson.peek();
  if (!now) return null;
  losses.value = [...losses.peek(), trainEpoch(now.brain, now.samples, settings.peek().rate)];
  if (losses.peek().length < now.total) return null;
  lesson.value = null;
  const match = Math.round(agreement(now.brain, now.samples) * 100);
  const switched = state.config.think !== TEACH_THINK;
  const base = now.before.replace(/ \+ твои заезды.*$/, ''); // «… + твои заезды + твои заезды» не копим
  setBrain(now.brain, {
    config: { ...state.config, think: TEACH_THINK },
    by: 'teach',
    generation: now.fresh ? 0 : state.generation,
    note: now.fresh ? `обучен на ${now.runs} ${plural(now.runs, 'заезде', 'заездах', 'заездах')}` : `${base} + твои заезды`,
  });
  return `Мозг повторяет тебя в ${match}% примеров и едет сам${switched ? `, думает теперь «${titleOf(TEACH_THINK)}»` : ''}. Прежний — в «Истории»`;
}

// ── «Как учится»: график ошибки, эпохи и шаг ──

const chart = canvas({ id: 'lossChart', className: 'chart', aria: { ariaLabel: 'Ошибка по эпохам' } });
const drawLoss = (values: readonly number[]) => drawSeries(chart, [...values], { label: 'Здесь появится график ошибки' });
/** Перерисовать график (сменилась тема или размер) */
export const redrawLoss = () => drawLoss(losses.peek());

function summary(): string {
  const loss = losses.value.at(-1);
  if (loss === undefined) return 'Здесь появится график ошибки: чем ниже, тем точнее мозг повторяет за тобой.';
  const total = lesson.value?.total;
  return `Эпоха ${epoch()}${total ? ` из ${total}` : ''} · ошибка ${loss.toFixed(3)}`;
}

export function LearnBox(): Node {
  effect(() => drawLoss(losses.value)); // новая эпоха — новая точка на графике
  return (
    <details className="learn-box" open={open} onToggle={(e) => {
      open.value = e.currentTarget.open;
      if (open.value) redrawLoss(); // свёрнутый холст был без размера
    }}>
      <summary>Как учится</summary>
      {chart}
      <p className="note" id="lrSummary">{summary}</p>
      <div className="field">
        <label htmlFor="epochs">Эпох</label>
        <input type="range" id="epochs" min="5" max="100" step="5" value={() => String(settings.value.epochs)}
          onInput={(e) => change({ epochs: +e.currentTarget.value })} />
        <output id="epochsOut">{() => settings.value.epochs}</output>
      </div>
      <div className="field wide">
        <span className="lbl">Шаг обучения</span>
        <div className="seg" aria={{ role: 'group', ariaLabel: 'Шаг обучения' }}>
          {RATES.map((rate) => (
            <button aria={{ ariaPressed: () => String(settings.value.rate === rate) }} onClick={() => change({ rate })}>
              {String(rate).replace('.', ',')}
            </button>
          ))}
        </div>
      </div>
      <p className="hint">Эпоха — один проход по всем примерам. Шаг — насколько сильно двигать веса за раз. Учёба продолжается с текущего мозга: его веса чуть-чуть подвигаются под твои заезды. Вариант мозга станет «Плавный» — обучение на примерах работает с плавными кривыми.</p>
    </details>
  );
}
