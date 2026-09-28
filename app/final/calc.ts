// Финал, шаг 2: расчёт. Все заезды считаются заранее, в Web Worker (pool.ts), — на стриме потом только запись.
// Одна секретная фраза + одни и те же файлы = один и тот же итог на любом компьютере.
import { effect, signal, untracked } from '@reely/dommy';
import {
  STAGES, stageLabel, stageSeed, stageTrack, hardStages, standings, superfinalists, finalStandings, nominations,
} from '../../engine/rally.ts';
import type { Award, StageResult, StageResults, StandingRow } from '../../engine/rally.ts';
import type { Track } from '../../engine/track.ts';
import type { Driver } from '../../engine/car.ts';
import { parseCarFile } from '../../engine/car-file.ts';
import { BOTS } from '../generated/bots.js';
import { showBanner } from '../stage.js';
import { runJobs, computeMode } from './pool.ts';
import { BUILT_IN } from './job.ts';
import { racers } from './works.ts';
import type { FinalEntry } from './entries.ts';

export const STAGE_COUNT = STAGES + 1; // этапы и суперфинал

/**
 * Посчитанный финал. entries — участники расчёта (dq — почему снят); results[этап] — заезды;
 * after[k] — общий зачёт после k+1 этапов; final — итог с суперфиналом; awards — номинации.
 */
export type Calc = {
  secret: string; entries: FinalEntry[]; tracks: Track[]; results: StageResults[];
  after: StandingRow<FinalEntry>[][]; final: StandingRow<FinalEntry>[]; awards: Award<FinalEntry>[];
};

/** Посчитанный финал или null */
export const calc = signal<Calc | null>(null);
/** Идёт расчёт: его можно остановить */
export const computing = signal<AbortController | null>(null);
/** Доля готовых заездов, null — не считаем */
export const progress = signal<number | null>(null);
export const computeNote = signal('');
/** Секретная фраза: из неё получаются трассы */
export const secret = signal('');

// Поменялся состав участников (новая папка, ключ, допуск) — прежний расчёт уже не про них
effect(() => {
  racers();
  untracked(() => {
    computing.value?.abort();
    calc.value = null;
    computeNote.value = '';
  });
});

type StageJob = { entry: FinalEntry; seed: string; stage: number };

/** Посчитать все этапы, потом суперфинал для первой десятки */
export async function compute(): Promise<void> {
  const phrase = secret.peek().trim();
  if (!phrase) {
    showBanner('Сначала придумайте секретную фразу', 2500);
    return;
  }
  // свои копии участников: пометка «снят» относится к этому расчёту, а не к файлам
  const entries = racers.peek().map((e): FinalEntry => ({ ...e, dq: null }));
  computing.peek()?.abort();
  const run = new AbortController();
  computing.value = run;
  calc.value = null;

  const started = performance.now();
  const tracks = Array.from({ length: STAGE_COUNT }, (_, i) => stageTrack(stageSeed(phrase, i)));
  const results: StageResults[] = tracks.map(() => new Map());
  const jobs: StageJob[] = [];
  for (let s = 0; s < STAGES; s++) for (const entry of entries) jobs.push({ entry, seed: stageSeed(phrase, s), stage: s });
  const total = jobs.length + Math.min(10, entries.length);
  const onProgress = (done: number) => {
    progress.value = done / total;
    computeNote.value = `Считаем заезды: ${done} из ${total}…`;
  };
  const onResult = (job: StageJob, result: StageResult | null) => {
    if (!result) return;
    if (result.status === 'hung') job.entry.dq = result.message; // завис — снят со всех этапов
    results[job.stage].set(job.entry.id, result);
  };
  onProgress(0);

  try {
    await runJobs(jobs, { onResult, onProgress, skip: (job) => !!job.entry.dq, signal: run.signal });
    if (run.signal.aborted) return;
    const after = Array.from({ length: STAGES }, (_, k) => standings(entries, results, k + 1));
    const finalists = superfinalists(after[STAGES - 1]);
    const superJobs = finalists.map((entry): StageJob => ({ entry, seed: stageSeed(phrase, STAGES), stage: STAGES }));
    await runJobs(superJobs, { onResult, onProgress: (done) => onProgress(jobs.length + done), signal: run.signal });
    if (run.signal.aborted) return;

    const final = finalStandings(after[STAGES - 1], results[STAGES]);
    const seconds = ((performance.now() - started) / 1000).toFixed(1);
    const hard = hardStages(tracks, bots()).map(stageLabel);
    const pageOnly = computeMode() === 'page' ? ' Браузер не дал создать Web Worker — участники со своим кодом не посчитаны.' : '';
    const warning = hard.length ? ` Осторожно, трудно: ${hard.join(', ')} — не доехал ни один бот. Может, взять другую фразу?` : '';
    computeNote.value = `Готово за ${seconds} с: ${entries.length} участников, ${jobs.length + finalists.length} заездов.${pageOnly}${warning}`;
    calc.value = { secret: phrase, entries, tracks, results, after, final, awards: nominations(entries, results, final) };
    showBanner(hard.length ? `${hard.join(', ')}: не доехал ни один бот. Может, взять другую фразу?` : 'Финал посчитан. Можно начинать шоу!', hard.length ? 5000 : 2500);
  } finally {
    if (computing.peek() === run) {
      computing.value = null;
      progress.value = null;
    }
  }
}

/** Боты с «Гонки» — мерка трудности этапа. Думают исходным student/think.js, как и участники в расчёте */
const bots = (): Driver[] => BOTS.map(parseCarFile).map((b) => ({ brain: b.brain, sensors: b.sensors, think: BUILT_IN[b.thinkId]?.think }));

/** Кто снят (код завис) и у кого ошибка в коде (едет со штрафом) — с причиной */
export function troubles(done: Calc): { hung: { entry: FinalEntry; why: string }[]; broken: { entry: FinalEntry; why: string }[] } {
  const firstError = (entry: FinalEntry) => done.results.map((m) => m.get(entry.id)).find((r) => r?.status === 'error');
  return {
    hung: done.entries.filter((e) => e.dq).map((entry) => ({ entry, why: entry.dq ?? '' })),
    broken: done.entries.flatMap((entry) => {
      const error = entry.dq ? undefined : firstError(entry);
      return error ? [{ entry, why: error.message ?? 'ошибка в коде' }] : [];
    }),
  };
}
