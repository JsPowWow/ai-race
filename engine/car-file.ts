// Файл машины для гонки: сенсоры, слои, вариант мозга, веса — и немного украшений (цвет, аватар).
// Здесь только проверка: модуль не знает ни про страницу, ни про код студента,
// поэтому его используют и вкладки, и расчёт финала в Web Worker, и скрипты в tools/.
import { hasSome, isPlainObject, isString, messageOf } from '@reely/basics';
import { layerSizes, checkBrain, LIMITS, type Brain } from './brain.ts';
import { rayCount, BACK_SPREAD, type Sensors } from './car.ts';
import { BUDGET, cost } from './build.ts';

// car@3 — мозг с памятью и дорожным знаком: сенсоры мгновение назад, знак и заметки (см. engine/brain.ts).
// Мозги car@1 и car@2 к ней не подходят: у них другое число входов.
export const FORMAT = 'ai-race/car@3';
const OLD_FORMATS = ['ai-race/car@1', 'ai-race/car@2', 'neuro-race/car@1'];

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
export function checkAvatar(svg: unknown): string | null {
  if (!hasSome(svg) || svg === '') return null;
  if (!isString(svg)) throw new Error('аватар должен быть строкой с SVG');
  const text = svg.trim();
  if (text.length > AVATAR_MAX) throw new Error(`аватар больше ${AVATAR_MAX} символов — упрости картинку`);
  if (!/^(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(text) || !/<\/svg>\s*$/i.test(text)) throw new Error('аватар должен быть SVG: <svg …>…</svg>');
  if (/<script|<foreignObject|<iframe|<object|<embed|\son\w+\s*=|javascript:|(href|src)\s*=\s*["']?\s*(https?:|\/\/)/i.test(text)) {
    throw new Error('в аватаре есть скрипт или внешняя ссылка — так нельзя');
  }
  return text;
}

export const avatarUrl = (svg: string | null | undefined): string | null => (svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : null);

/** Файл машины, каким он пришёл: JSON от кого угодно, ни одному полю верить нельзя */
type RawCarFile = {
  format?: unknown; name?: unknown; color?: unknown; avatar?: unknown;
  sensors?: { count?: unknown; spread?: unknown; length?: unknown; back?: unknown; backLength?: unknown; backSpread?: unknown };
  layers?: unknown; brain?: unknown; think?: unknown; thinkSource?: unknown;
};

/** Проверенный файл машины. code — текст своего модуля think.js (только для варианта «Мой»), think ещё не выбран */
export type ParsedCar = {
  name: string; color: string | null; avatar: string | null;
  sensors: Sensors; sizes: number[]; brain: Brain; thinkId: string; code: string | null;
};

/** Проверить файл участника. Бросает Error с понятным текстом */
export function parseCarFile(input: unknown): ParsedCar {
  const file: RawCarFile = isPlainObject(input) ? input : {};
  if (isString(file.format) && OLD_FORMATS.includes(file.format)) {
    throw new Error(`${String(file.name || 'Машина').slice(0, NAME_MAX)}: файл старого формата (мозг без знака) — обучи мозг заново и сохрани файл`);
  }
  if (file.format !== FORMAT) {
    throw new Error(`это не файл машины (нет format: "${FORMAT}")`);
  }
  const name = String(file.name || 'Без имени').trim().slice(0, NAME_MAX) || 'Без имени';
  const fail = (msg: string): never => { throw new Error(`${name}: ${msg}`); };

  const color = isString(file.color) && /^#[0-9a-f]{6}$/i.test(file.color) ? file.color.toLowerCase() : null;
  let avatar = null;
  try {
    avatar = checkAvatar(file.avatar);
  } catch (e) {
    fail(messageOf(e));
  }

  const s = file.sensors ?? {};
  const sensors: Sensors = { count: Number(s.count) | 0, spread: Number(s.spread), length: Number(s.length) };
  if (sensors.count < LIMITS.sensorsMin || sensors.count > LIMITS.sensorsMax) fail(`сенсоров должно быть от ${LIMITS.sensorsMin} до ${LIMITS.sensorsMax}`);
  if (!(sensors.spread >= 30 && sensors.spread <= 180)) fail('угол обзора вне 30–180°');
  if (!(sensors.length >= 80 && sensors.length <= 260)) fail('дальность вне 80–260 px');
  if (s.back) { // сенсоры назад — по желанию; в старых файлах их нет
    const back = Number(s.back) | 0, backLength = Number(s.backLength), backSpread = Number(s.backSpread ?? BACK_SPREAD);
    Object.assign(sensors, { back, backLength, backSpread });
    if (back < 0 || back > LIMITS.backMax) fail(`сенсоров назад — не больше ${LIMITS.backMax}`);
    if (!(backLength >= 40 && backLength <= 200)) fail('дальность сенсоров назад вне 40–200 px');
    if (!(backSpread >= 10 && backSpread <= 180)) fail('угол обзора сзади вне 10–180°');
  }

  const layers: unknown[] = Array.isArray(file.layers) ? file.layers : [];
  const hidden = layers.slice(1, -1).filter((n) => typeof n === 'number');
  const tooBig = hidden.length !== Math.max(0, layers.length - 2) || hidden.length > LIMITS.hiddenLayersMax
    || hidden.some((n) => !(n >= LIMITS.neuronsMin && n <= LIMITS.neuronsMax));
  if (tooBig) fail('сеть больше разрешённой');
  const price = cost({ sensors, hidden });
  if (price > BUDGET) fail(`сборка стоит ${price} очков, а бюджет — ${BUDGET}`);
  const sizes = layerSizes(rayCount(sensors), hidden);
  const brainError = checkBrain(file.brain, sizes);
  if (brainError) fail(brainError);

  const thinkId = String(file.think ?? '');
  let code = null;
  if (thinkId === 'mine') {
    if (!isString(file.thinkSource) || !file.thinkSource.trim()) return fail('вариант «Мой», но нет thinkSource');
    code = file.thinkSource.slice(0, CODE_MAX);
  }
  return { name, color, avatar, sensors, sizes, brain: file.brain as Brain, thinkId, code }; // мозг проверен checkBrain выше
}
