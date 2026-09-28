// Расчёт финала в нескольких Web Worker сразу.
// Каждый Worker берёт по одной задаче; если задача не отвечает JOB_TIMEOUT_MS — Worker уничтожаем,
// участник получает статус 'hung', а на его место запускаем новый Worker.
import { failedResult } from '../../engine/rally.ts';
import { WORKER_SOURCE } from '../generated/race-worker.js';
import { runJob } from './job.js';

const JOB_TIMEOUT_MS = 5000;
const PAGE_CHUNK = 25; // без Worker: сколько задач считать между кадрами, чтобы страница не замирала

let workerUrl;
function workerSupported() {
  if (typeof Worker !== 'function' || typeof Blob !== 'function') return false;
  try {
    workerUrl ??= URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
    new Worker(workerUrl).terminate();
    return true;
  } catch {
    return false;
  }
}

/** Чем считаем: 'workers' — изолированно и параллельно, 'page' — на странице, без чужого кода */
export const computeMode = () => (workerSupported() ? 'workers' : 'page');

/**
 * Посчитать задачи. jobs — [{ entry, seed, … }].
 * onResult(job, result) — на каждую задачу; skip(job) — пропустить (например, участник уже снят).
 * signal — AbortController.signal, чтобы остановить расчёт.
 */
export function runJobs(jobs, { onResult, onProgress = () => {}, skip = () => false, signal }) {
  return computeMode() === 'workers'
    ? inWorkers(jobs, { onResult, onProgress, skip, signal })
    : onPage(jobs, { onResult, onProgress, skip, signal });
}

const payload = (job, jobId) => ({
  jobId,
  seed: job.seed,
  entry: { id: job.entry.id, brain: job.entry.brain, sensors: job.entry.sensors, thinkId: job.entry.thinkId, code: job.entry.code },
});

function inWorkers(jobs, { onResult, onProgress, skip, signal }) {
  // пока идёт расчёт, странице почти нечего делать, поэтому Worker'ов — по числу ядер (но не меньше двух)
  const size = Math.max(1, Math.min(8, Math.max(2, navigator.hardwareConcurrency || 4), jobs.length));
  let next = 0;
  let done = 0;
  return new Promise((resolve) => {
    const slots = [];
    const stopAll = () => {
      for (const slot of slots) {
        clearTimeout(slot.timer);
        slot.worker?.terminate();
        slot.worker = null;
      }
      resolve();
    };
    signal?.addEventListener('abort', stopAll, { once: true });

    const spawn = (slot) => {
      slot.worker = new Worker(workerUrl);
      slot.worker.onmessage = ({ data }) => settle(slot, data.result);
      slot.worker.onerror = (e) => {
        e.preventDefault();
        settle(slot, failedResult('error', `расчёт упал: ${e.message || 'неизвестная ошибка'}`));
      };
    };
    const settle = (slot, result) => {
      clearTimeout(slot.timer);
      const { job } = slot;
      if (!job || signal?.aborted) return;
      slot.job = null;
      onResult(job, result);
      onProgress(++done, jobs.length);
      feed(slot);
    };
    const feed = (slot) => {
      while (next < jobs.length && skip(jobs[next])) {
        onResult(jobs[next++], null);
        onProgress(++done, jobs.length);
      }
      if (next >= jobs.length) {
        slot.worker.terminate();
        slot.worker = null;
        if (slots.every((s) => !s.worker)) resolve();
        return;
      }
      slot.job = jobs[next];
      slot.timer = setTimeout(() => {
        slot.worker.terminate();
        spawn(slot);
        settle(slot, failedResult('hung', `код думал дольше ${JOB_TIMEOUT_MS / 1000} с — завис или слишком медленный`));
      }, JOB_TIMEOUT_MS);
      slot.worker.postMessage(payload(jobs[next], next));
      next++;
    };

    for (let i = 0; i < size; i++) {
      const slot = { worker: null, job: null, timer: 0 };
      spawn(slot);
      slots.push(slot);
    }
    slots.forEach(feed);
  });
}

function onPage(jobs, { onResult, onProgress, skip, signal }) {
  let i = 0;
  return new Promise((resolve) => {
    const chunk = () => {
      if (signal?.aborted) return resolve();
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
