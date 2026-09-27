// Мелкие помощники для работы со страницей.
import { avatarUrl } from '../engine/car-file.js';

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

/** Безопасно вставить текст в HTML */
export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Тики → «12,4 с» (60 тиков = 1 секунда) */
export const secs = (ticks) => `${(ticks / 60).toFixed(1).replace('.', ',')} с`;
export const pct = (value) => `${Math.round(value)}%`;

/** [{ id, title }] → <option>…</option> */
export const options = (items) => items.map(({ id, title }) => `<option value="${id}">${esc(title)}</option>`).join('');

/** Нажатое состояние у группы кнопок-переключателей */
export function setPressed(selector, isOn) {
  for (const button of $$(selector)) button.setAttribute('aria-pressed', String(isOn(button)));
}

/**
 * CSS-размер элемента, который обновляется сам, когда элемент меняет размер.
 * Читать clientWidth в каждом кадре дорого: браузер каждый раз пересчитывает вёрстку.
 */
export function liveSize(el) {
  const size = { width: el.clientWidth, height: el.clientHeight };
  new ResizeObserver(([entry]) => {
    size.width = entry.contentRect.width;
    size.height = entry.contentRect.height;
  }).observe(el);
  return size;
}

/** Обработчик на контейнере для его динамических детей */
export function delegate(root, event, selector, handler) {
  $(root).addEventListener(event, (e) => {
    const target = e.target.closest(selector);
    if (target) handler(target, e);
  });
}

export function showError(selector, message) {
  const el = $(selector);
  el.hidden = !message;
  el.textContent = message || '';
}

export const isTyping = (el) => !!el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable);

/** Аватар участника (картинка через <img> — скрипты из SVG так не выполняются) или кружок его цвета */
export const avatarTag = ({ avatar, color }) => (avatar
  ? `<img class="avatar" src="${esc(avatarUrl(avatar))}" alt="" loading="lazy">`
  : `<span class="car-dot" style="background:${esc(color)}"></span>`);
