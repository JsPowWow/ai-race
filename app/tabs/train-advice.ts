// «Рой сейчас»: одна фраза — что происходит с роем и что делать дальше.
// Чистая функция: всё, на что она смотрит, приходит аргументом.
import { TRAINING_TRACKS } from '../../engine/track.ts';
import type { Track } from '../../engine/track.ts';
import { FITNESS_PARTS } from '../../engine/recipes.ts';
import { secs, pct } from '../ui.ts';
import type { HistoryEntry } from '../state.ts';

/** Столько поколений без улучшения — рой застрял */
const STUCK_GENS = 10;
/** Столько поколений подряд лучший не меняется — рою нечему учиться */
const SAME_GENS = 5;

export type SwarmNow = {
  /** рой запускали (есть поколение) */
  started: boolean;
  running: boolean;
  /** есть обученный мозг — рой начнёт с него */
  trained: boolean;
  history: HistoryEntry[];
  /** трасса текущего поколения */
  track: Track | null;
  /** лидер прошлого поколения: сколько раз заехал в медленную зону на развилке */
  slowdowns: number;
  /** фитнес хвалит за время: «Мой вариант» или галочка «Бонус за финиш и время» */
  timeBonus: boolean;
};

/** Поколения подряд на той же трассе, что сейчас, — только их и можно сравнивать */
function sameTrackHistory(history: HistoryEntry[], track: Track | null): HistoryEntry[] {
  let from = history.length;
  while (from > 0 && history[from - 1].trackId === track?.id) from--;
  return history.slice(from);
}

export function swarmAdvice({ started, running, trained, history, track, slowdowns, timeBonus }: SwarmNow): string {
  if (!started) {
    return trained
      ? 'Нажми «Старт»: рой начнёт с текущего мозга и будет его улучшать.'
      : 'Нажми «Старт»: сто машин со случайными мозгами поедут разом. Сначала почти все разобьются — это нормально.';
  }
  if (!running) return 'Пауза. «Продолжить» — рой пойдёт дальше с того же места.';
  const h = sameTrackHistory(history, track), last = h.at(-1);
  if (!track || !last) return 'Смотри, какая машина уедет дальше всех: от неё пойдёт следующее поколение. Долго — жми «Турбо».';
  const maze = track.islands.length > 0;
  const finishBonus = `Поставь галочку «${FITNESS_PARTS.finish.title}».`;
  if (maze && last.finished && slowdowns > 0) {
    return timeBonus
      ? `Доехал, но в медленную зону на развилке заехал ${slowdowns} раз. Время дороже — рой ещё научится читать знак.`
      : `Доехал, но в медленную зону на развилке заехал ${slowdowns} раз. Без бонуса за время рою всё равно — кто доехал, тот и хорош. ${finishBonus}`;
  }
  if (maze && last.finished) {
    return 'Каждый круг — по свободному пути: рой читает знак. Посмотри в «Мозге лидера», как горит вход «зн» у знака и что делают заметки m1…m3 после него — знак-то остаётся позади раньше развилки.';
  }
  const tail = h.slice(-SAME_GENS);
  if (tail.length === SAME_GENS && tail.every((e) => e.finished && e.best === last.best)) {
    if (TRAINING_TRACKS.some((t) => t.id === track.id) && track.id !== 'snake') {
      return 'Здесь рой уже доехал. Цель урока — «Змейка» с машинами: выбери её в «Трасса».';
    }
    return timeBonus
      ? `${SAME_GENS} поколений подряд никто не обогнал лучшего. Попробуй «Смелую» мутацию или другую трассу.`
      : `Рой доехал — и больше не ускоряется: без бонуса за время все доехавшие для него равны. ${finishBonus}`;
  }
  const before = h.at(-STUCK_GENS - 1);
  if (!last.finished && before && h.slice(-STUCK_GENS).every((e) => !e.finished && e.best <= before.best)) {
    return `${STUCK_GENS} поколений без улучшения: рой застрял на ${pct(last.progressPct)} — лучший бьётся в одном и том же месте. Помоги: в «Рецепте роя» поставь галочку «${FITNESS_PARTS.careful.title}» или выбери «Смелую» мутацию, или поставь «Без машин», а потом верни встречных.`;
  }
  if (last.finished) return `Лучший доехал за ${secs(last.ticks)}. Рой ищет мозг, который фитнес оценит ещё выше.`;
  return `Лучший в прошлом поколении проехал ${pct(last.progressPct)}. Пусть линия на графике ползёт вверх.`;
}
