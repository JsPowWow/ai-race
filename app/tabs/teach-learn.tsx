// «Я учу», обучение на заездах: мозг учится повторять за тобой — по эпохе за кадр, чтобы было видно,
// как падает ошибка. Учёба продолжает копию твоего мозга; выученное — новый вариант: контрольный заезд
// против твоего мозга, и если лучше — «Взять» (app/variants.ts). Сам мозг учёба не меняет.
import { signal, effect, canvas } from '@reely/dommy';
import { createBrain, cloneBrain, checkBrain } from '../../engine/brain.ts';
import type { Brain } from '../../engine/brain.ts';
import { trainEpoch, agreement, TEACH_THINK } from '../../engine/imitation.ts';
import type { Sample } from '../../engine/imitation.ts';
import { drawSeries } from '../../engine/netviz.ts';
import { state, sizesOf, brainTitle, thinkVariant, on } from '../state.ts';
import { stored } from '../storage.ts';
import { live } from '../student-code.ts';
import { trainingSamples } from '../runs.ts';
import { propose } from '../variants.ts';
import { getTrainingTrack, type Track } from '../../engine/track.ts';
import { withTraffic } from '../../engine/traffic.ts';
import { fromEvents } from '../signals.ts';
import { plural } from './teach-words.ts';
import { Seg, type Choice } from '../components/controls.tsx';

/** Трасса урока — та, где ты ездишь: на ней (и ещё на одной) вариант едет контрольный заезд */
export const lessonTrack = (): Track => withTraffic(getTrainingTrack(state.drive.trackId), state.drive.traffic);

/** Меньше примеров — учить не на чем: это пара заездов по «Разминке» */
export const MIN_SAMPLES = 200;

/** Сколько раз пройти по всем примерам (эпох) — простыми словами */
const REPEATS: Choice<number>[] = [{ id: 10, title: 'Мало' }, { id: 20, title: 'Средне' }, { id: 50, title: 'Много' }];
/** Насколько сильно двигать веса за раз (шаг обучения) */
const RATES: Choice<number>[] = [{ id: 0.01, title: 'Чуть-чуть' }, { id: 0.05, title: 'Обычно' }, { id: 0.2, title: 'Сильно' }, { id: 1, title: 'Очень' }];

/** Сколько эпох и какой шаг — помним между заходами. Чего нет среди кнопок (старые настройки) — по умолчанию */
type Settings = { epochs: number; rate: number };
const isSettings = (v: unknown): v is Settings =>
  typeof v === 'object' && v !== null && 'epochs' in v && REPEATS.some((r) => r.id === v.epochs) && 'rate' in v && RATES.some((r) => r.id === v.rate);
const settings = stored<Settings>('teach', { epochs: 20, rate: 0.05 }, isSettings);
const change = (next: Partial<Settings>) => (settings.value = { ...settings.peek(), ...next });

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

/** Что показать, когда доучился: текст баннера и стал ли вариант твоим мозгом */
export type Learned = { text: string; taken: boolean };

/**
 * Одна эпоха (зовёт кадровый цикл, пока идёт обучение). Доучился — вариант идёт на контрольный заезд,
 * возвращаем, чем кончилось; иначе null.
 */
export function trainStep(): Learned | null {
  const now = lesson.peek();
  if (!now) return null;
  losses.value = [...losses.peek(), trainEpoch(now.brain, now.samples, settings.peek().rate)];
  if (losses.peek().length < now.total) return null;
  lesson.value = null;
  const match = Math.round(agreement(now.brain, now.samples) * 100);
  const switched = state.config.think !== TEACH_THINK;
  const base = now.before.replace(/ \+ твои заезды.*$/, ''); // «… + твои заезды + твои заезды» не копим
  const runs = `${now.runs} ${plural(now.runs, 'заезде', 'заездах', 'заездах')}`;
  const attempt = propose({
    brain: now.brain,
    config: { ...state.config, think: TEACH_THINK },
    by: 'teach',
    note: now.fresh ? `обучен на ${runs}` : `${base} + твои заезды`,
  }, lessonTrack(), `учёба на ${runs}`);
  const repeats = `Мозг повторяет тебя в ${match}% примеров`;
  if (!attempt) return { text: `${repeats}. Едет так же, как твой`, taken: false };
  if (attempt.mark === 'first') return { text: `${repeats} и едет сам${switched ? `, думает теперь «${titleOf(TEACH_THINK)}»` : ''}`, taken: true };
  if (attempt.taken) return { text: `Новый вариант лучше: ${attempt.text}. Взят — прежний в «Истории»`, taken: true };
  if (attempt.mark === 'better') return { text: `Новый вариант лучше: ${attempt.text}. «Взять» — под трассой`, taken: false };
  return { text: `${attempt.mark === 'worse' ? 'Новый вариант хуже' : 'Новый вариант едет так же'}: ${attempt.text}. Твой мозг остался прежним`, taken: false };
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
      <div className="field stack">
        <span className="lbl">Сколько повторять</span>
        <Seg label="Сколько повторять" items={REPEATS} value={() => settings.value.epochs} pick={(epochs) => change({ epochs })} />
      </div>
      <div className="field stack">
        <span className="lbl">Как сильно поправлять</span>
        <Seg label="Как сильно поправлять" items={RATES} value={() => settings.value.rate} pick={(rate) => change({ rate })} />
      </div>
      <p className="hint">Повторять — сколько раз пройти по всем твоим примерам (один проход — эпоха). Поправлять — насколько сильно двигать веса за раз: слишком сильно — мозг скачет и не учится. Учится копия твоего мозга: что выйдет — новый вариант. Он проедет контрольный заезд, и под трассой будет видно, лучше он или хуже. Вариант мозга станет «Плавный» — обучение на примерах работает с плавными кривыми.</p>
    </details>
  );
}
