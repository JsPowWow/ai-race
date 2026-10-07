// Мелкие помощники для работы со страницей.
import { media } from '@reely/dommy-kit';

/** Человек просил в системе меньше движения: без вращений, качки и листаний */
export const calm = media('(prefers-reduced-motion: reduce)');
/** Узкий экран — как @media (max-width: 700px) в стилях */
export const phone = media('(max-width: 700px)');

/** Все элементы по селектору. Один нужный элемент — element() из app/dom.ts */
export const $$ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T[] => [...root.querySelectorAll<T>(selector)];

/** Безопасно вставить текст в HTML-строку — нужно только для табло над трассой (setHud). В JSX текст и так вставляется как текст */
const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: unknown): string => String(s).replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);

/**
 * CSS-размер элемента, который обновляется сам, когда элемент меняет размер.
 * Читать clientWidth в каждом кадре дорого: браузер каждый раз пересчитывает вёрстку.
 * Не size() из dommy-kit: тот до первого замера отдаёт 0 × 0, а холсту нужен размер с первого кадра.
 * Холсты живут всё время, пока открыта страница, — следить за размером перестанем вместе с ней.
 */
export function liveSize(el: Element): { width: number; height: number } {
  const size = { width: el.clientWidth, height: el.clientHeight };
  new ResizeObserver(([entry]) => {
    if (!entry) return;
    size.width = entry.contentRect.width;
    size.height = entry.contentRect.height;
  }).observe(el);
  return size;
}

/** Человек печатает в поле — клавиши не наши */
export const isTyping = (el: EventTarget | null): boolean =>
  el instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable);

