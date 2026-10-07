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
/** Поле табло: подпись и значение жирным — «время <b>12,4 с</b>». Сам экранирует: сюда можно имя трассы из seed */
export const field = (label: string, value: string | number): string => `${esc(label)} <b>${esc(value)}</b>`;
/** Жирное слово на табло: название трассы, этап */
export const bold = (text: string | number): string => `<b>${esc(text)}</b>`;

/** Человек печатает в поле — клавиши не наши */
export const isTyping = (el: EventTarget | null): boolean =>
  el instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable);

