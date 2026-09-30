// Мост между событиями app/state.ts и сигналами @reely/dommy (#20).
// Вкладки на dommy не перерисовывают себя целиком: пришло событие — сигнал перечитал данные,
// и страница обновила ровно те узлы, что от них зависят.
import { signal } from '@reely/dommy';
import { on, type AppEvent } from './state.ts';

export type { AppEvent };

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
