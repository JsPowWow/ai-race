// Файл машины для гонки: только числа — сенсоры, слои, вариант мозга и веса.
import { layerSizes, checkBrain, LIMITS } from '../engine/brain.js';
import { state, sizesOf, CAR_COLORS } from './state.js';
import { live, getSource, compileModule, evalAvailable } from './student-code.js';

export const FORMAT = 'ai-race/car@1';
const LEGACY_FORMATS = ['neuro-race/car@1'];

/** Текущий чемпион в формате файла (или null, если мозга ещё нет) */
export function toCarFile() {
  if (!state.champion) return null;
  const file = {
    format: FORMAT,
    name: state.profile.name.trim() || 'Без имени',
    color: state.profile.color,
    think: state.config.think,
    sensors: { ...state.config.sensors },
    layers: sizesOf(),
    brain: state.champion,
    trainedGenerations: state.generation,
  };
  if (file.think === 'mine') file.thinkSource = getSource('think');
  return file;
}

/** Проверить файл участника и подготовить его к гонке. Бросает Error с понятным текстом. */
export function fromCarFile(file, fallbackColor = CAR_COLORS[0]) {
  if (!file || (file.format !== FORMAT && !LEGACY_FORMATS.includes(file.format))) {
    throw new Error(`это не файл машины (нет format: "${FORMAT}")`);
  }
  const name = String(file.name || 'Без имени').slice(0, 24);
  const fail = (msg) => { throw new Error(`${name}: ${msg}`); };

  const color = /^#[0-9a-f]{6}$/i.test(file.color) ? file.color : fallbackColor;
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

  return { name, color, sensors, sizes, brain: file.brain, think: resolveThink(file, fail), thinkId: file.think, file };
}

function resolveThink(file, fail) {
  if (file.think !== 'mine') {
    return live.think.thinkVariants?.[file.think]?.think ?? fail(`неизвестный вариант мозга «${file.think}»`);
  }
  if (!file.thinkSource) fail('вариант «Мой», но нет thinkSource');
  if (!evalAvailable()) fail('свой think() здесь запустить нельзя');
  const think = compileModule(String(file.thinkSource)).thinkVariants?.mine?.think;
  return typeof think === 'function' ? think : fail('в thinkSource нет thinkVariants.mine');
}
