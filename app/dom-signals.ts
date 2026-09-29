// Состояние страницы как сигналы: подходит ли экран под медиазапрос, какого размера элемент, значение «не чаще, чем…».
// Временные: такие же (media, size, throttled) уже есть в @reely/dommy/kit — выйдут в 0.1.0-next.2,
// и этот файл заменит одна строка импорта (#20). Имена и вид результата (Computed) — как там.
// Всё, что слушает или держит таймер, останавливается вместе с компонентом, который это создал.
import { signal, computed, effect, untracked, onCleanup, type Computed } from '@reely/dommy';

/** Подходит ли экран под медиазапрос: повернули телефон или включили «меньше движения» — страница узнала */
export function media(query: string): Computed<boolean> {
  const list = matchMedia(query);
  const matches = signal(list.matches);
  const update = () => (matches.value = list.matches);
  list.addEventListener('change', update);
  onCleanup(() => list.removeEventListener('change', update));
  return computed(() => matches.value);
}

/** Размер элемента в CSS-пикселях (без рамок и отступов) — через ResizeObserver. До первого замера — 0×0, как в kit */
export function size(el: Element): Computed<{ width: number; height: number }> {
  const box = signal({ width: 0, height: 0 });
  const observer = new ResizeObserver(([entry]) => {
    if (entry) box.value = { width: entry.contentRect.width, height: entry.contentRect.height };
  });
  observer.observe(el);
  onCleanup(() => observer.disconnect());
  return computed(() => box.value);
}

/**
 * То же значение, но не чаще раза в ms: первое изменение проходит сразу, последнее — в конце.
 * Нужно для объявлений читалке экрана: пересказывать гонку каждые полсекунды — только мешать.
 */
export function throttled<T>(source: () => T, ms: number): Computed<T> {
  const value = signal(untracked(source));
  let last = -Infinity;
  let timer: number | undefined;
  effect(() => {
    source(); // подписались: источник поменялся — пора (или скоро пора) обновить
    if (timer !== undefined) return;
    timer = window.setTimeout(() => {
      timer = undefined;
      last = performance.now();
      value.value = untracked(source);
    }, Math.max(0, last + ms - performance.now()));
  });
  onCleanup(() => clearTimeout(timer));
  return computed(() => value.value);
}
