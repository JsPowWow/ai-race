// Файл машины на странице: собрать свой из чемпиона и подготовить чужой к гонке.
// Сама проверка файла — в engine/car-file.ts.
import { FORMAT, parseCarFile, type ParsedCar } from '../engine/car-file.ts';
import { compileMineThink } from '../engine/compile.ts';
import type { Brain } from '../engine/brain.ts';
import type { Sensors, Think } from '../engine/car.ts';
import { state, sizesOf, CAR_COLORS } from './state.ts';
import { live, getSource, evalAvailable } from './student-code.ts';

/** Файл машины для гонки (формат ai-race/car@3) */
export type CarFile = {
  format: string; name: string; color: string; avatar?: string;
  think: string; thinkSource?: string; sensors: Sensors; layers: number[];
  brain: Brain; trainedGenerations: number;
};

/**
 * Участник гонки из файла. think — чем он думает; null — свой код ещё не прочитан человеком
 * (тогда машина не едет, см. approveCode). file — как файл пришёл: его показывают и скрещивают.
 */
export type Entrant = Omit<ParsedCar, 'color'> & { color: string; file: object; think: Think | null };

/** Текущий чемпион в формате файла (или null, если мозга ещё нет) */
export function toCarFile(): CarFile | null {
  if (!state.champion) return null;
  const file: CarFile = {
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
export function fromCarFile(file: unknown, fallbackColor = CAR_COLORS[0]): Entrant {
  const parsed = parseCarFile(file);
  // parseCarFile пропускает только объекты: у всего прочего нет format
  const entrant: Entrant = { ...parsed, color: parsed.color ?? fallbackColor, file: file as object, think: null };
  // Чужой код не запускаем сразу: сначала его читает преподаватель (см. approveCode)
  if (parsed.code) return entrant;
  const variants = live.think.thinkVariants ?? {};
  const variant = Object.hasOwn(variants, parsed.thinkId) ? variants[parsed.thinkId] : undefined;
  if (!variant) throw new Error(`${parsed.name}: неизвестный вариант мозга «${parsed.thinkId}»`);
  entrant.think = variant.think;
  return entrant;
}

/** Запустить свой вариант мозга участника — только после того, как человек прочитал код */
export function approveCode(entrant: Entrant): void {
  if (!evalAvailable()) throw new Error('здесь нельзя запускать свой код');
  if (!entrant.code) return;
  // что вернёт чужой think, машина проверяет сама: нечисла и NaN становятся нулями (safe в engine/car.ts)
  entrant.think = compileMineThink(entrant.code) as Think;
}
