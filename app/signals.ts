// Мост между событиями app/state.js и сигналами @reely/dommy (#20).
// Вкладки на dommy не перерисовывают себя целиком: пришло событие — сигнал перечитал данные,
// и страница обновила ровно те узлы, что от них зависят.
import { signal } from '@reely/dommy';
import { on } from './state.ts';

/** События state.js (что каждое значит — там же) */
export type AppEvent = 'champion' | 'reset' | 'code' | 'config' | 'library' | 'car' | 'garage' | 'save';

/**
 * Значение из общего состояния, которое само обновляется по событиям: read() перечитывается,
 * когда приходит любое из events. Читать — вызовом, как сигнал: profile().name.
 *
 * Рассылает всегда, даже если read() вернул тот же объект: state и гараж меняют на месте,
 * тот же объект ещё не значит те же данные.
 */
export function fromEvents<T>(events: AppEvent[], read: () => T): () => T {
  const box = signal({ value: read() });
  for (const event of events) on(event, () => (box.value = { value: read() }));
  return () => box.value.value;
}
