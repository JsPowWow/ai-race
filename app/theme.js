// Тема сайта: как в системе, светлая или тёмная. Кнопка в шапке перебирает их по кругу.
//
// Выбор хранится в браузере. Чтобы страница не мигала тёмным при светлой теме, его применяет ещё
// крошечный скрипт в <head> (tools/build.mjs) — до того, как браузер нарисует первый кадр.
import { load, save } from './storage.js';
import { cssColor } from '../engine/render.js';
import { $, $$ } from './ui.js';

const THEMES = ['system', 'light', 'dark'];
const LABELS = { system: 'Авто', light: 'Светлая', dark: 'Тёмная' };
const HINTS = { system: 'Тема как в системе', light: 'Светлая тема', dark: 'Тёмная тема' };

const button = $('#themeToggle');
const themeColors = $$('meta[name="theme-color"]');
for (const meta of themeColors) meta.dataset.auto = meta.content;
const systemDark = matchMedia('(prefers-color-scheme: dark)');

/**
 * Включить переключатель. onChange() вызывается, когда цвета поменялись, —
 * холсты (трасса, схема сети, график) нужно перерисовать: сами они CSS не слушают.
 */
export function initTheme(onChange) {
  const saved = load('theme', 'system');
  let theme = THEMES.includes(saved) ? saved : 'system';
  const apply = () => {
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    button.querySelector('.theme-label').textContent = LABELS[theme];
    button.setAttribute('aria-label', `${HINTS[theme]}. Нажми, чтобы сменить`);
    button.title = HINTS[theme];
    // Шапка браузера на телефоне: в «Авто» — свой цвет для светлой и тёмной системы, иначе — фон выбранной темы
    for (const meta of themeColors) meta.content = theme === 'system' ? meta.dataset.auto : cssColor('--bg');
  };
  button.addEventListener('click', () => {
    theme = THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
    save('theme', theme);
    apply();
    onChange();
  });
  systemDark.addEventListener('change', () => {
    if (theme !== 'system') return;
    apply();
    onChange();
  });
  apply();
}
