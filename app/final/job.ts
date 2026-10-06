// Одна задача расчёта финала: участник × этап. Без DOM — выполняется в Web Worker
// (а если браузер не дал создать Worker — прямо на странице, но тогда без чужого кода).
import { thinkVariants } from '../../student/think.js';
import { compileMineThink } from '../../engine/course/compile.ts';
import { maxTicksFor } from '../../engine/world/car.ts';
import type { Think } from '../../engine/world/car.ts';
import { driveRecorded, failedResult, stageTrack } from '../../engine/world/rally.ts';
import type { StageResult } from '../../engine/world/rally.ts';
import type { Track } from '../../engine/world/track.ts';
import type { FinalEntry } from './entries.ts';
import { messageOf, toErrorWithMessage } from '@reely/basics';

/** Что нужно расчёту от участника: мозг, сенсоры и чем он думает */
export type JobEntry = Pick<FinalEntry, 'id' | 'brain' | 'sensors' | 'thinkId' | 'code'>;
/** Задача: участник и seed трассы этапа */
export type Job = { entry: JobEntry; seed: string };

/** Встроенные варианты мозга — из исходного student/think.js: правки преподавателя на «Коде» на финал не влияют */
export const BUILT_IN: Record<string, { think: Think } | undefined> = thinkVariants;

const tracks = new Map<string, Track>();
const thinks = new Map<string, Think | Error>(); // id участника → функция think или ошибка сборки

function trackFor(seed: string): Track {
  let track = tracks.get(seed);
  if (!track) tracks.set(seed, (track = stageTrack(seed)));
  return track;
}

/** Собрать свой вариант мозга участника (один раз на участника) */
function compileOwn(entry: JobEntry, code: string): Think | Error {
  let think = thinks.get(entry.id);
  if (!think) {
    try {
      // что вернёт чужой think, неизвестно — машина сама считает «не нажато» всё, что не число (см. press в engine/world/car.ts)
      think = compileMineThink(code) as Think;
    } catch (e) {
      think = toErrorWithMessage(e);
    }
    thinks.set(entry.id, think);
  }
  return think;
}

function thinkFor(entry: JobEntry, allowCode: boolean): Think {
  if (!entry.code) {
    const variant = Object.hasOwn(BUILT_IN, entry.thinkId) ? BUILT_IN[entry.thinkId] : undefined;
    if (!variant) throw new Error(`неизвестный вариант мозга «${entry.thinkId}»`);
    return variant.think;
  }
  if (!allowCode) throw new Error('свой код запускается только в Web Worker, а браузер его не создал');
  const think = compileOwn(entry, entry.code);
  if (think instanceof Error) throw think;
  return think;
}

/** Проехать этап. allowCode — можно ли запускать чужой код (только в Web Worker) */
export function runJob({ entry, seed }: Job, { allowCode }: { allowCode: boolean }): StageResult {
  const track = trackFor(seed);
  let think: Think;
  try {
    think = thinkFor(entry, allowCode);
  } catch (e) {
    return failedResult('error', `код не запустился: ${messageOf(e)}`, maxTicksFor(track));
  }
  return driveRecorded(track, { brain: entry.brain, think, sensors: entry.sensors });
}
