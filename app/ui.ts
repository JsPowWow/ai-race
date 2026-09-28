// Мелкие помощники для работы со страницей.
import { avatarUrl } from '../engine/car-file.ts';

/** Элемент по селектору (или null). Тип уточняет вызывающий: $<HTMLInputElement>('#name') */
export const $ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T | null => root.querySelector<T>(selector);
export const $$ = <T extends Element = HTMLElement>(selector: string, root: ParentNode = document): T[] => [...root.querySelectorAll<T>(selector)];

/** Безопасно вставить текст в HTML-строку (в JSX не нужно: там текст всегда вставляется как текст) */
const ENTITIES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: unknown): string => String(s).replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);

/** Тики → «12,4 с» (60 тиков = 1 секунда) */
export const secs = (ticks: number): string => `${(ticks / 60).toFixed(1).replace('.', ',')} с`;
export const pct = (value: number): string => `${Math.round(value)}%`;

/** [{ id, title }] → <option>…</option> */
export const options = (items: { id: string; title: string }[]): string =>
  items.map(({ id, title }) => `<option value="${esc(id)}">${esc(title)}</option>`).join('');

/** Нажатое состояние у группы кнопок-переключателей */
export function setPressed(selector: string, isOn: (button: HTMLElement) => boolean): void {
  for (const button of $$(selector)) button.setAttribute('aria-pressed', String(isOn(button)));
}

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

/** Обработчик на контейнере для его динамических детей */
export function delegate(root: string, event: string, selector: string, handler: (target: HTMLElement, e: Event) => void): void {
  $(root)?.addEventListener(event, (e) => {
    const target = e.target instanceof Element ? e.target.closest<HTMLElement>(selector) : null;
    if (target) handler(target, e);
  });
}

export function showError(selector: string, message: string): void {
  const el = $(selector);
  if (!el) return;
  el.hidden = !message;
  el.textContent = message || '';
}

/** Человек печатает в поле — клавиши не наши */
export const isTyping = (el: EventTarget | null): boolean =>
  el instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable);

/** Аватар участника (картинка через <img> — скрипты из SVG так не выполняются) или кружок его цвета */
export const avatarTag = ({ avatar, color }: { avatar?: string | null; color: string }): string => {
  const url = avatarUrl(avatar);
  return url
    ? `<img class="avatar" src="${esc(url)}" alt="" loading="lazy">`
    : `<span class="car-dot" style="background:${esc(color)}"></span>`;
};
