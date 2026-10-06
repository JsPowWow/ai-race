// «Гонка», скрещивание двух участников: подходят ли они друг другу и какой получится ребёнок.
// Сами веса ребёнка считает crossover() студента (student/crossover.js).
import { mix } from '@reely/colors';
import { cloneBrain } from '../../engine/net/brain.ts';
import type { Brain } from '../../engine/net/brain.ts';
import type { Think } from '../../engine/world/car.ts';
import { NAME_MAX } from '../../engine/course/car-file.ts';
import { live } from '../student-code.ts';

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
  // что вернул crossover() студента, проверит parseCarFile, когда ребёнок встанет в гонку
  const brain = live.crossover.crossover(cloneBrain(mom.brain), cloneBrain(dad.brain));
  return { ...mom.file, name: `${mom.name} × ${dad.name}`.slice(0, NAME_MAX), color: mix(mom.color, dad.color), brain };
}
