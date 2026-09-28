// Тема сайта: как в системе, светлая или тёмная. Кнопка в шапке перебирает их по кругу.
//
// Выбор хранится в браузере. Чтобы страница не мигала тёмным при светлой теме, его применяет ещё
// крошечный скрипт в <head> (tools/build.mjs) — до того, как браузер нарисует первый кадр.
import { load, save } from './storage.ts';
import { cssColor } from '../engine/render.ts';
import { $$ } from './ui.ts';
import { element } from './dom.ts';

type Theme = 'system' | 'light' | 'dark';
const THEMES: Theme[] = ['system', 'light', 'dark'];
const LABELS: Record<Theme, string> = { system: 'Авто', light: 'Светлая', dark: 'Тёмная' };
const HINTS: Record<Theme, string> = { system: 'Тема как в системе', light: 'Светлая тема', dark: 'Тёмная тема' };

const button = element('#themeToggle');
const label = element('#themeToggle .theme-label');
const themeColors = $$<HTMLMetaElement>('meta[name="theme-color"]');
for (const meta of themeColors) meta.dataset.auto = meta.content;
const systemDark = matchMedia('(prefers-color-scheme: dark)');

/**
 * Включить переключатель. onChange() вызывается, когда цвета поменялись, —
 * холсты (трасса, схема сети, график) нужно перерисовать: сами они CSS не слушают.
 */
export function initTheme(onChange: () => void): void {
  const saved = load<string>('theme', 'system');
  let theme: Theme = THEMES.find((t) => t === saved) ?? 'system';
  const apply = () => {
    if (theme === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    label.textContent = LABELS[theme];
    button.setAttribute('aria-label', `${HINTS[theme]}. Нажми, чтобы сменить`);
    button.title = HINTS[theme];
    // Шапка браузера на телефоне: в «Авто» — свой цвет для светлой и тёмной системы, иначе — фон выбранной темы
    for (const meta of themeColors) meta.content = theme === 'system' ? (meta.dataset.auto ?? '') : cssColor('--bg');
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
