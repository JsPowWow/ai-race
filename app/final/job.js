// Одна задача расчёта финала: участник × этап. Без DOM — выполняется в Web Worker
// (а если браузер не дал создать Worker — прямо на странице, но тогда без чужого кода).
import { thinkVariants } from '../../student/think.js';
import { compileMineThink } from '../../engine/compile.ts';
import { maxTicksFor } from '../../engine/car.ts';
import { driveRecorded, failedResult, stageTrack } from '../../engine/rally.ts';

const tracks = new Map();
const thinks = new Map(); // id участника → функция think или ошибка сборки

function trackFor(seed) {
  if (!tracks.has(seed)) tracks.set(seed, stageTrack(seed));
  return tracks.get(seed);
}

function thinkFor(entry, allowCode) {
  // Встроенные варианты берём из исходного student/think.js — правки преподавателя на «Коде» не влияют
  if (!entry.code) {
    if (!Object.hasOwn(thinkVariants, entry.thinkId)) throw new Error(`неизвестный вариант мозга «${entry.thinkId}»`);
    return thinkVariants[entry.thinkId].think;
  }
  if (!allowCode) throw new Error('свой код запускается только в Web Worker, а браузер его не создал');
  if (!thinks.has(entry.id)) {
    try {
      thinks.set(entry.id, compileMineThink(entry.code));
    } catch (e) {
      thinks.set(entry.id, e instanceof Error ? e : new Error(String(e)));
    }
  }
  const think = thinks.get(entry.id);
  if (think instanceof Error) throw think;
  return think;
}

/** { entry: { id, brain, sensors, thinkId, code }, seed } → запись заезда */
export function runJob({ entry, seed }, { allowCode }) {
  const track = trackFor(seed);
  let think;
  try {
    think = thinkFor(entry, allowCode);
  } catch (e) {
    return failedResult('error', `код не запустился: ${e.message}`, maxTicksFor(track));
  }
  return driveRecorded(track, { brain: entry.brain, think, sensors: entry.sensors });
}
