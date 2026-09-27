// «Мои заезды»: записанные ручные заезды для обучения с учителем.
// Заезд — это примеры «что видела сеть → что нажал человек», упакованные в строки (см. engine/imitation.js).
import { packSample, unpackSample, worthLearning } from '../engine/imitation.js';
import { load, save, remove, usedBytes } from './storage.js';

export const MAX_SAMPLES = 8000;  // всего во всех заездах — чтобы хватило места в браузере
export const MIN_RUN = 30;        // заезды короче (полсекунды) не сохраняем
export const DROP_BEFORE_CRASH = 45; // перед аварией последние 0,75 с не учим

/** [{ id, at, trackName, traffic, status, progressPct, ticks, inputs, packed: string[], on }] */
export let runs = loadRuns();

function loadRuns() {
  const list = load('runs', null);
  if (list) return list;
  // раньше примеры лежали одной кучей на вкладке «Учитель» — переносим их одним заездом
  const packed = load('teachPacked', []);
  remove('teachPacked');
  remove('teachRuns');
  remove('teachSamples');
  const kept = packed.filter((p) => worthLearning(unpackSample(p)));
  const migrated = kept.length >= MIN_RUN
    ? [{ id: 'old', at: new Date().toISOString(), trackName: 'Старые записи', traffic: 'none', status: 'stopped', progressPct: 0, ticks: kept.length, inputs: unpackSample(kept[0]).x.length, packed: kept, on: true }]
    : [];
  save('runs', migrated);
  return migrated;
}

/** false — не хватило места в браузере */
export function saveRuns() {
  return save('runs', runs);
}

export const sampleCount = (list = runs) => list.reduce((n, r) => n + r.packed.length, 0);

/**
 * Добавить заезд. samples — [{ x, y }] в порядке тиков.
 * Возвращает сохранённый заезд или null, если он слишком короткий.
 */
export function addRun(samples, { trackName, traffic, status, progressPct, ticks }) {
  const kept = status === 'crashed' ? samples.slice(0, -DROP_BEFORE_CRASH) : samples;
  if (kept.length < MIN_RUN) return null;
  const run = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    at: new Date().toISOString(),
    trackName, traffic, status, progressPct, ticks,
    inputs: kept[0].x.length,
    packed: kept.map(packSample),
    on: status !== 'crashed' || progressPct > 30, // короткую аварию по умолчанию не учим
  };
  runs = [run, ...runs];
  while (sampleCount() > MAX_SAMPLES && runs.length > 1) runs = runs.slice(0, -1); // старые уходят
  saveRuns();
  return run;
}

export function toggleRun(id) {
  const run = runs.find((r) => r.id === id);
  if (run) run.on = !run.on;
  saveRuns();
}

export function removeRun(id) {
  runs = runs.filter((r) => r.id !== id);
  saveRuns();
}

export function clearRuns() {
  runs = [];
  saveRuns();
}

/** Примеры из отмеченных заездов, записанных с тем же числом входов, что у сети сейчас */
export function trainingSamples(inputs) {
  const usable = runs.filter((r) => r.on && r.inputs === inputs);
  return { runs: usable, samples: usable.flatMap((r) => r.packed.map(unpackSample)) };
}

export const memoryNote = (saved) => (saved
  ? `В памяти браузера: ${(usedBytes() / 1024).toFixed(0)} КБ из примерно 5000.`
  : 'Не хватило места в памяти браузера: новые заезды живут до перезагрузки. Удали лишние заезды.');
