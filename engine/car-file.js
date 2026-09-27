// Файл машины для гонки: сенсоры, слои, вариант мозга, веса — и немного украшений (цвет, аватар).
// Здесь только проверка: модуль не знает ни про страницу, ни про код студента,
// поэтому его используют и вкладки, и расчёт финала в Web Worker, и скрипты в tools/.
import { layerSizes, checkBrain, LIMITS } from './brain.js';

export const FORMAT = 'ai-race/car@1';
const LEGACY_FORMATS = ['neuro-race/car@1'];

/** Цвета машин по умолчанию (если в файле своего нет) */
export const CAR_COLORS = ['#ffd60a', '#ff9f1c', '#ff3b30', '#ff3d7f', '#9b5cff', '#22d3ee', '#3ddc84', '#a3e635'];

export const NAME_MAX = 24;
export const CODE_MAX = 20000;
export const AVATAR_MAX = 8000; // символов SVG — хватит на простую картинку

/**
 * Аватар — SVG-картинка. Показываем её только через <img> (и на canvas через Image):
 * в таком виде браузер не выполняет скрипты и не грузит ничего из сети.
 * Проверка ниже — вторая линия защиты: отбрасываем то, чему в картинке делать нечего.
 * Возвращает строку SVG или null (аватара нет). Бросает Error, если аватар плохой.
 */
export function checkAvatar(svg) {
  if (svg === undefined || svg === null || svg === '') return null;
  if (typeof svg !== 'string') throw new Error('аватар должен быть строкой с SVG');
  const text = svg.trim();
  if (text.length > AVATAR_MAX) throw new Error(`аватар больше ${AVATAR_MAX} символов — упрости картинку`);
  if (!/^(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(text) || !/<\/svg>\s*$/i.test(text)) throw new Error('аватар должен быть SVG: <svg …>…</svg>');
  if (/<script|<foreignObject|<iframe|<object|<embed|\son\w+\s*=|javascript:|(href|src)\s*=\s*["']?\s*(https?:|\/\/)/i.test(text)) {
    throw new Error('в аватаре есть скрипт или внешняя ссылка — так нельзя');
  }
  return text;
}

export const avatarUrl = (svg) => (svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : null);

/**
 * Проверить файл участника. Бросает Error с понятным текстом.
 * Возвращает { name, color, avatar, sensors, sizes, brain, thinkId, code }.
 * code — текст своего модуля think.js (только для варианта «Мой»), think ещё не выбран.
 */
export function parseCarFile(file) {
  if (!file || typeof file !== 'object' || (file.format !== FORMAT && !LEGACY_FORMATS.includes(file.format))) {
    throw new Error(`это не файл машины (нет format: "${FORMAT}")`);
  }
  const name = String(file.name || 'Без имени').trim().slice(0, NAME_MAX) || 'Без имени';
  const fail = (msg) => { throw new Error(`${name}: ${msg}`); };

  const color = /^#[0-9a-f]{6}$/i.test(file.color) ? file.color.toLowerCase() : null;
  let avatar = null;
  try {
    avatar = checkAvatar(file.avatar);
  } catch (e) {
    fail(e.message);
  }

  const s = file.sensors ?? {};
  const sensors = { count: s.count | 0, spread: +s.spread, length: +s.length };
  if (sensors.count < LIMITS.sensorsMin || sensors.count > LIMITS.sensorsMax) fail(`лучей должно быть от ${LIMITS.sensorsMin} до ${LIMITS.sensorsMax}`);
  if (!(sensors.spread >= 30 && sensors.spread <= 180)) fail('угол обзора вне 30–180°');
  if (!(sensors.length >= 80 && sensors.length <= 260)) fail('дальность вне 80–260 px');

  const hidden = Array.isArray(file.layers) ? file.layers.slice(1, -1) : [];
  const tooBig = hidden.length > LIMITS.hiddenLayersMax || hidden.some((n) => !(n >= LIMITS.neuronsMin && n <= LIMITS.neuronsMax));
  if (tooBig) fail('сеть больше разрешённой');
  const sizes = layerSizes(sensors.count, hidden);
  const brainError = checkBrain(file.brain, sizes);
  if (brainError) fail(brainError);

  const thinkId = String(file.think ?? '');
  let code = null;
  if (thinkId === 'mine') {
    if (typeof file.thinkSource !== 'string' || !file.thinkSource.trim()) fail('вариант «Мой», но нет thinkSource');
    code = file.thinkSource.slice(0, CODE_MAX);
  }
  return { name, color, avatar, sensors, sizes, brain: file.brain, thinkId, code };
}
