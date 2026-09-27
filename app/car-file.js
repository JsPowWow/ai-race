// Файл машины на странице: собрать свой из чемпиона и подготовить чужой к гонке.
// Сама проверка файла — в engine/car-file.js.
import { FORMAT, parseCarFile } from '../engine/car-file.js';
import { compileMineThink } from '../engine/compile.js';
import { state, sizesOf, CAR_COLORS } from './state.js';
import { live, getSource, evalAvailable } from './student-code.js';

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
  if (state.profile.avatar) file.avatar = state.profile.avatar;
  if (file.think === 'mine') file.thinkSource = getSource('think');
  return file;
}

/** Проверить файл участника и подготовить его к гонке на этой странице. Бросает Error. */
export function fromCarFile(file, fallbackColor = CAR_COLORS[0]) {
  const parsed = parseCarFile(file);
  const entrant = { ...parsed, color: parsed.color ?? fallbackColor, file, think: null };
  // Чужой код не запускаем сразу: сначала его читает преподаватель (см. approveCode)
  if (parsed.code) return entrant;
  const variants = live.think.thinkVariants ?? {};
  if (!Object.hasOwn(variants, parsed.thinkId)) throw new Error(`${parsed.name}: неизвестный вариант мозга «${parsed.thinkId}»`);
  entrant.think = variants[parsed.thinkId].think;
  return entrant;
}

/** Запустить свой вариант мозга участника — только после того, как человек прочитал код */
export function approveCode(entrant) {
  if (!evalAvailable()) throw new Error('здесь нельзя запускать свой код');
  entrant.think = compileMineThink(entrant.code);
}
