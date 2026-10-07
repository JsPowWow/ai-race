// Мост между событиями app/state.ts и сигналами @reely/dommy (#20).
// Вкладки на dommy не перерисовывают себя целиком: пришло событие — сигнал перечитал данные,
// и страница обновила ровно те узлы, что от них зависят.
import { signal } from '@reely/dommy';
import { on, thinkVariants, type AppEvent, type ThinkVariant } from './state.ts';

export type { AppEvent };

/** Мозг сменился: обучили, сбросили или пересели в другую машину (про `car` легко забыть) */
export const BRAIN_EVENTS: AppEvent[] = ['champion', 'reset', 'car'];
/** Сборка сменилась: форма сети, вариант мозга, другая машина или поправили think.js */
export const SHAPE_EVENTS: AppEvent[] = ['config', 'car', 'code'];

/**
 * Значение из общего состояния, которое само обновляется по событиям: read() перечитывается,
 * когда приходит любое из events. Читать — вызовом, как сигнал: profile().name.
 *
 * Рассылает всегда, даже если read() вернул тот же объект: state и гараж меняют на месте,
 * тот же объект ещё не значит те же данные.
 */
export function fromEvents<T>(events: AppEvent[], read: () => T): () => T {
  const value = signal(read(), { equals: false });
  for (const event of events) on(event, () => (value.value = read()));
  return value;
}

/** Варианты мозга из student/think.js: поправили код — список другой */
export const variants = fromEvents<Record<string, ThinkVariant>>(['code'], thinkVariants);
