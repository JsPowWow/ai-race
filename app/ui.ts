// Мелкие помощники для работы со страницей.

/** Все элементы по селектору. Один нужный элемент — element() из app/dom.ts */
export const $$ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T[] => [...root.querySelectorAll<T>(selector)];

/** Безопасно вставить текст в HTML-строку — нужно только для табло над трассой (setHud). В JSX текст и так вставляется как текст */
const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: unknown): string => String(s).replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);

/** Тики → «12,4 с» (60 тиков = 1 секунда) */
export const secs = (ticks: number): string => `${(ticks / 60).toFixed(1).replace('.', ',')} с`;
export const pct = (value: number): string => `${Math.round(value)}%`;

/**
 * CSS-размер элемента, который обновляется сам, когда элемент меняет размер.
 * Читать clientWidth в каждом кадре дорого: браузер каждый раз пересчитывает вёрстку.
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

