// Тема сайта: как в системе, светлая или тёмная. Кнопка в шапке перебирает их по кругу.
//
// Выбор хранится в браузере. Чтобы страница не мигала тёмным при светлой теме, его применяет ещё
// крошечный скрипт в <head> (tools/build.mjs) — до того, как браузер нарисует первый кадр.
import { stored } from './storage.ts';
import { effect, untracked } from '@reely/dommy';
import { cssColor } from '../engine/render.ts';
import { $$ } from './ui.ts';
import { element } from './dom.ts';
import { listen } from '@reely/dommy/kit';

type Theme = 'system' | 'light' | 'dark';
const THEMES: Theme[] = ['system', 'light', 'dark'];
const LABELS: Record<Theme, string> = { system: 'Авто', light: 'Светлая', dark: 'Тёмная' };
const HINTS: Record<Theme, string> = { system: 'Тема как в системе', light: 'Светлая тема', dark: 'Тёмная тема' };

const button = element('#themeToggle');
const label = element('#themeToggle .theme-label');
const themeColors = $$<HTMLMetaElement>('meta[name="theme-color"]');
for (const meta of themeColors) meta.dataset.auto = meta.content;
const isTheme = (v: unknown): v is Theme => THEMES.some((t) => t === v);
/** Выбор помним в браузере; сменили тему в другой вкладке — сменится и здесь */
const theme = stored<Theme>('theme', 'system', isTheme);
const systemDark = matchMedia('(prefers-color-scheme: dark)');

function apply(now: Theme): void {
  if (now === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = now;
  label.textContent = LABELS[now];
  button.setAttribute('aria-label', `${HINTS[now]}. Нажми, чтобы сменить`);
  button.title = HINTS[now];
  // Шапка браузера на телефоне: в «Авто» — свой цвет для светлой и тёмной системы, иначе — фон выбранной темы
  for (const meta of themeColors) meta.content = now === 'system' ? (meta.dataset.auto ?? '') : cssColor('--bg');
}

/**
 * Включить переключатель. onChange() вызывается, когда цвета поменялись, —
 * холсты (трасса, схема сети, график) нужно перерисовать: сами они CSS не слушают.
 */
export function initTheme(onChange: () => void): void {
  listen(button, 'click', () => (theme.value = THEMES[(THEMES.indexOf(theme.peek()) + 1) % THEMES.length]));
  let started = false;
  effect(() => {
    apply(theme.value);
    // при запуске холсты ещё не нарисованы — перерисовывать нечего; что читает перерисовка, эффект не касается
    if (started) untracked(onChange);
    started = true;
  });
  // в «Авто» цвета идут за системой
  listen(systemDark, 'change', () => theme.peek() === 'system' && onChange());
}
