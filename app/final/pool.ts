// Расчёт финала в нескольких Web Worker сразу.
// Каждый Worker берёт по одной задаче; если задача не отвечает JOB_TIMEOUT_MS — Worker уничтожаем,
// участник получает статус 'hung', а на его место запускаем новый Worker.
import { isSomeFunction } from '@reely/basics';
import { failedResult } from '../../engine/rally.ts';
import type { StageResult } from '../../engine/rally.ts';
import { WORKER_SOURCE } from '../generated/race-worker.js';
import { runJob } from './job.ts';
import type { Job } from './job.ts';
import type { JobMessage } from './worker.ts';
import { listen } from '@reely/dommy/kit';

const JOB_TIMEOUT_MS = 5000;
const PAGE_CHUNK = 25; // без Worker: сколько задач считать между кадрами, чтобы страница не замирала

/** Чем считаем: 'workers' — изолированно и параллельно, 'page' — на странице, без чужого кода */
export type ComputeMode = 'workers' | 'page';

let workerUrl = '';
let mode: ComputeMode | null = null;

/** Пробуем один раз: создаётся ли Worker из нашего кода (его может запретить политика браузера или сайта) */
export function computeMode(): ComputeMode {
  if (mode) return mode;
  mode = 'page';
  if (isSomeFunction(globalThis.Worker) && isSomeFunction(globalThis.Blob)) {
    try {
      workerUrl = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
      new Worker(workerUrl).terminate();
      mode = 'workers';
    } catch { /* остаёмся на странице */ }
  }
  return mode;
}

export type RunOptions<J extends Job> = {
  /** Результат задачи; null — задачу пропустили (skip) */
  onResult: (job: J, result: StageResult | null) => void;
  /** Сколько задач готово из скольких */
  onProgress?: (done: number, total: number) => void;
  /** Пропустить задачу (например, участник уже снят) */
  skip?: (job: J) => boolean;
  /** Остановить расчёт */
  signal?: AbortSignal;
};

/** Посчитать задачи. Промис выполняется, когда всё посчитано или расчёт остановлен */
export function runJobs<J extends Job>(jobs: J[], options: RunOptions<J>): Promise<void> {
  const all: Required<RunOptions<J>> = {
    onResult: options.onResult,
    onProgress: options.onProgress ?? (() => {}),
    skip: options.skip ?? (() => false),
    signal: options.signal ?? new AbortController().signal, // никто не остановит
  };
  return computeMode() === 'workers' ? inWorkers(jobs, all) : onPage(jobs, all);
}

/** Worker получает только то, что нужно расчёту: без имени, аватара и прочего */
const message = (job: Job, jobId: number): JobMessage => ({
  jobId,
  seed: job.seed,
  entry: { id: job.entry.id, brain: job.entry.brain, sensors: job.entry.sensors, thinkId: job.entry.thinkId, code: job.entry.code },
});

/** Место для одного Worker: он сам, его задача и таймер зависания */
type Slot<J> = { worker: Worker | null; job: J | null; timer: ReturnType<typeof setTimeout> | undefined };

function inWorkers<J extends Job>(jobs: J[], { onResult, onProgress, skip, signal }: Required<RunOptions<J>>): Promise<void> {
  // пока идёт расчёт, странице почти нечего делать, поэтому Worker'ов — по числу ядер (но не меньше двух)
  const size = Math.max(1, Math.min(8, Math.max(2, navigator.hardwareConcurrency || 4), jobs.length));
  let next = 0;
  let done = 0;
  return new Promise((resolve) => {
    const slots: Slot<J>[] = [];
    const stopAll = () => {
      for (const slot of slots) {
        clearTimeout(slot.timer);
        slot.worker?.terminate();
        slot.worker = null;
      }
      resolve();
    };
    const stopListening = listen(signal, 'abort', stopAll, { once: true });
    const finish = () => {
      stopListening();
      resolve();
    };

    const spawn = (slot: Slot<J>) => {
      const worker = new Worker(workerUrl);
      worker.onmessage = ({ data }: MessageEvent<{ result: StageResult }>) => settle(slot, data.result);
      worker.onerror = (e) => {
        e.preventDefault();
        settle(slot, failedResult('error', `расчёт упал: ${e.message || 'неизвестная ошибка'}`));
      };
      slot.worker = worker;
    };
    const settle = (slot: Slot<J>, result: StageResult) => {
      clearTimeout(slot.timer);
      const { job } = slot;
      if (!job || signal.aborted) return;
      slot.job = null;
      onResult(job, result);
      onProgress(++done, jobs.length);
      feed(slot);
    };
    const feed = (slot: Slot<J>) => {
      while (next < jobs.length && skip(jobs[next])) {
        onResult(jobs[next++], null);
        onProgress(++done, jobs.length);
      }
      const worker = slot.worker;
      if (!worker) return;
      if (next >= jobs.length) {
        worker.terminate();
        slot.worker = null;
        if (slots.every((s) => !s.worker)) finish();
        return;
      }
      const jobId = next++;
      slot.job = jobs[jobId];
      slot.timer = setTimeout(() => {
        worker.terminate();
        spawn(slot);
        settle(slot, failedResult('hung', `код думал дольше ${JOB_TIMEOUT_MS / 1000} с — завис или слишком медленный`));
      }, JOB_TIMEOUT_MS);
      worker.postMessage(message(slot.job, jobId));
    };

    for (let i = 0; i < size; i++) {
      const slot: Slot<J> = { worker: null, job: null, timer: undefined };
      spawn(slot);
      slots.push(slot);
    }
    slots.forEach(feed);
  });
}

function onPage<J extends Job>(jobs: J[], { onResult, onProgress, skip, signal }: Required<RunOptions<J>>): Promise<void> {
  let i = 0;
  return new Promise((resolve) => {
    const chunk = () => {
      if (signal.aborted) return resolve();
      for (let n = 0; n < PAGE_CHUNK && i < jobs.length; n++, i++) {
        const job = jobs[i];
        onResult(job, skip(job) ? null : runJob(job, { allowCode: false }));
        onProgress(i + 1, jobs.length);
      }
      if (i < jobs.length) setTimeout(chunk, 0);
      else resolve();
    };
    chunk();
  });
}
