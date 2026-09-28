// «Гонка», скрещивание двух участников: подходят ли они друг другу и какой получится ребёнок.
// Сами веса ребёнка считает crossover() студента (student/crossover.js).
import { cloneBrain } from '../../engine/brain.ts';
import type { Brain } from '../../engine/brain.ts';
import type { Think } from '../../engine/car.ts';
import { NAME_MAX } from '../../engine/car-file.ts';
import { live } from '../student-code.js';

/** Что нужно знать о родителе */
export type Parent = { name: string; color: string; sizes: number[]; brain: Brain; think: Think | null; file: object };

/** Скрестить можно двоих с одинаковой сетью; мама отдаёт ребёнку сенсоры и вариант мозга, поэтому её think уже должен работать */
export const canCross = (mom: Parent, dad: Parent): boolean => mom.sizes.join() === dad.sizes.join() && !!mom.think;

/** Подсказка под кнопкой «Скрестить» */
export function crossNote(mom: Parent | undefined, dad: Parent | undefined): string {
  if (!mom || !dad) return 'Отметь галочками двух участников, чтобы получить их ребёнка.';
  if (canCross(mom, dad)) return `Ребёнок возьмёт сенсоры и вариант мозга у «${mom.name}», веса — через твой crossover().`;
  if (!mom.think) return `Не скрестить: код «${mom.name}» ещё не проверен. Сначала разреши его.`;
  return `Не скрестить: у «${mom.name}» сеть ${mom.sizes.join('-')}, у «${dad.name}» — ${dad.sizes.join('-')}. Нужна одинаковая.`;
}

/** Файл машины-ребёнка. Бросает Error, если сломался crossover() студента */
export function childFile(mom: Parent, dad: Parent): object {
  const brain: Brain = live.crossover.crossover(cloneBrain(mom.brain), cloneBrain(dad.brain));
  return { ...mom.file, name: `${mom.name} × ${dad.name}`.slice(0, NAME_MAX), color: mixColors(mom.color, dad.color), brain };
}

/** Цвет посередине между двумя: '#ff0000' и '#0000ff' → '#800080' */
export function mixColors(a: string, b: string): string {
  const channel = (hex: string, i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);
  const mixed = [0, 1, 2].map((i) => Math.round((channel(a, i) + channel(b, i)) / 2).toString(16).padStart(2, '0'));
  return `#${mixed.join('')}`;
}
