// «Мои заезды»: записанные ручные заезды для обучения с учителем.
// Заезд — это примеры «что видела сеть → что нажал человек», упакованные в строки (см. engine/learn/imitation.ts).
// Заезды — у каждой машины гаража свои (записаны под её сенсоры): лежат в её папке, в runs.json.
// Здесь — заезды выбранной машины; пересели в другую — гараж подменит их через setRuns().
import { packSample, unpackSample, worthLearning, type Sample } from '../engine/learn/imitation.ts';
import type { CarStatus } from '../engine/world/car.ts';
import type { TrafficLevel } from '../engine/world/traffic.ts';
import { emit } from './state.ts';
import { load, remove } from './storage.ts';

export const MAX_SAMPLES = 8000;  // всего во всех заездах — чтобы хватило места в браузере
export const MIN_RUN = 30;        // заезды короче (полсекунды) не сохраняем
export const DROP_BEFORE_CRASH = 45; // перед аварией последние 0,75 с не учим

/** Чем кончился заезд: как у машины, плюс stopped — человек сам нажал «Заново» */
export type RunStatus = Exclude<CarStatus, 'driving'> | 'stopped';
/** Что известно о заезде, кроме примеров */
export type RunInfo = { trackName: string; traffic: TrafficLevel; status: RunStatus; progressPct: number; ticks: number };
/**
 * Записанный заезд. inputs — сколько входов было у сети (заезды другой сборки не учим),
 * packed — примеры строками (engine/learn/imitation.ts), on — учить ли на нём.
 */
export type Run = RunInfo & { id: string; at: string; inputs: number; packed: string[]; on: boolean };

export let runs: Run[] = [];

/** Заезды другой машины (зовёт гараж, когда пересаживаемся) */
export function setRuns(list: Run[]): void {
  runs = list;
}

/** До гаража заезды лежали в localStorage: забираем их первой машине гаража и освобождаем место */
export function legacyRuns(): Run[] {
  const list = load<Run[] | null>('runs', null);
  remove('runs');
  if (list) return list;
  // раньше примеры лежали одной кучей на вкладке «Учитель» — переносим их одним заездом
  const packed = load<string[]>('teachPacked', []);
  remove('teachPacked');
  remove('teachRuns');
  remove('teachSamples');
  const kept = packed.filter((p) => worthLearning(unpackSample(p)));
  const [first] = kept;
  const migrated: Run[] = first && kept.length >= MIN_RUN
    ? [{ id: 'old', at: new Date().toISOString(), trackName: 'Старые записи', traffic: 'none', status: 'stopped', progressPct: 0, ticks: kept.length, inputs: unpackSample(first).x.length, packed: kept, on: true }]
    : [];
  return migrated;
}

/** Заезды поменялись — гараж запишет их в папку машины */
function saveRuns(): void {
  emit('save');
}

export const sampleCount = (list: Run[] = runs): number => list.reduce((n, r) => n + r.packed.length, 0);

/**
 * Добавить заезд. samples — [{ x, y }] в порядке тиков.
 * Возвращает сохранённый заезд или null, если он слишком короткий.
 */
export function addRun(samples: Sample[], { trackName, traffic, status, progressPct, ticks }: RunInfo): Run | null {
  const kept = status === 'crashed' ? samples.slice(0, -DROP_BEFORE_CRASH) : samples;
  const [first] = kept;
  if (!first || kept.length < MIN_RUN) return null;
  const run: Run = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    at: new Date().toISOString(),
    trackName, traffic, status, progressPct, ticks,
    inputs: first.x.length,
    packed: kept.map(packSample),
    on: status !== 'crashed' || progressPct > 30, // короткую аварию по умолчанию не учим
  };
  runs = [run, ...runs];
  while (sampleCount() > MAX_SAMPLES && runs.length > 1) runs = runs.slice(0, -1); // старые уходят
  saveRuns();
  return run;
}

export function toggleRun(id: string): void {
  const run = runs.find((r) => r.id === id);
  if (run) run.on = !run.on;
  saveRuns();
}

export function removeRun(id: string): void {
  runs = runs.filter((r) => r.id !== id);
  saveRuns();
}

export function clearRuns(): void {
  runs = [];
  saveRuns();
}

/** Твой лучший финиш на трассе с такими же машинами (null — ещё не доезжал) */
export function bestRun(trackName: string, traffic: TrafficLevel): Run | null {
  const finished = runs.filter((r) => r.status === 'finished' && r.trackName === trackName && r.traffic === traffic);
  return finished.reduce<Run | null>((best, r) => (!best || r.ticks < best.ticks ? r : best), null);
}

/** Примеры из отмеченных заездов, записанных с тем же числом входов, что у сети сейчас */
export function trainingSamples(inputs: number): { runs: Run[]; samples: Sample[] } {
  const usable = runs.filter((r) => r.on && r.inputs === inputs);
  return { runs: usable, samples: usable.flatMap((r) => r.packed.map(unpackSample)) };
}
