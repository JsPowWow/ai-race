// Подписи «Табло мозга» для мозга данной формы: имена входов и выходов, заголовки рамок, петля заметок.
import { inputLabels, sensorsOf, OUTPUT_LABELS } from '../../engine/brain.ts';
import type { Act } from './formula.ts';

/** Заголовок рамки: на обычном экране — две строки (заголовок и пояснение), на узком — одна короткая */
export type FrameTitle = { wide: [title: string, sub: string]; narrow: string };

export type Labels = {
  /** сколько сенсоров */
  n: number;
  inputs: string[]; outputs: readonly string[];
  /** заголовки рамок по id из layout.ts (input, notesIn, hidden0…, buttons, notesOut) */
  frames: Record<string, FrameTitle>;
  /** подпись петли заметок: обычная и для узкого экрана */
  loop: { wide: string; narrow: string };
  /** над первой парой кружков входа: маленький — «было», большой — «сейчас» */
  past: [before: string, now: string];
};

/** @param sizes нейронов в каждом слое, @param act как подписать активации */
export function labelsFor(sizes: readonly number[], act: Act): Labels {
  const n = sensorsOf(sizes[0]);
  const frames: Record<string, FrameTitle> = {
    input: { wide: [`СЕНСОРЫ s1–s${n}, скорость v, знак зн`, 'пунктир — мгновение назад'], narrow: 'СЕНСОРЫ, v, зн' },
    notesIn: { wide: ['ЗАМЕТКИ m1–m3', 'с прошлого шага'], narrow: 'ЗАМЕТКИ' },
    buttons: { wide: ['ПУЛЬТ', act.outName], narrow: 'ПУЛЬТ' },
    notesOut: { wide: ['ЗАМЕТКИ', 'на следующий шаг'], narrow: 'ЗАМЕТКИ' },
  };
  sizes.slice(1, -1).forEach((size, k) => {
    frames[`hidden${k}`] = { wide: [`СЛОЙ · ${size} нейронов`, act.hiddenName], narrow: `СЛОЙ · ${size}` };
  });
  return {
    n, inputs: inputLabels(n), outputs: OUTPUT_LABELS, frames,
    loop: { wide: 'заметки → на вход следующего шага', narrow: '→ на следующий шаг' },
    past: ['было', 'сейчас'],
  };
}
