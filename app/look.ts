// Облик страницы: тема, размер окна, догрузившиеся шрифты. Поменялся — холсты перечитывают цвета и перерисовываются.
// main.ts сообщает о перемене (lookChanged), а каждый холст сам решает, что перерисовать (onLook).
import { signal, effect, untracked } from '@reely/dommy';
import { readPalette } from '../engine/draw/render.ts';

/** Сколько раз облик менялся: 0 — ещё ни разу, страница только загрузилась */
const changes = signal(0);

/** Облик поменялся: палитра холстов — заново, и все, кто подписан через onLook(), перерисуются */
export function lookChanged(): void {
  readPalette();
  changes.update((n) => n + 1);
}

/**
 * Перерисовать холст, когда облик поменялся. Не сразу: при загрузке холст рисует сама вкладка.
 * Что читает redraw, на подписку не влияет: перерисовку зовёт только перемена облика
 */
export function onLook(redraw: () => void): void {
  effect(() => {
    if (changes.value) untracked(redraw);
  });
}
