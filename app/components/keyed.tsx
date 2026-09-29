// Сахар поверх @reely/dommy: построить кусок страницы заново, когда сменилось значение.
// Show так не умеет: он смотрит только «есть или нет», и при смене «урок 1 → урок 2» оставил бы старый кусок.
import { For } from '@reely/dommy';
import type { ReelyNode } from '@reely/dommy';

/** Что годится в ключ: сравнивается по значению */
type Key = string | number | boolean | null | undefined;

/**
 * Рисует children(value()) и рисует заново, когда value() стало другим: старый кусок убирается
 * вместе со своими подписками. Внутри — For из одной строки, ключ которой и есть значение.
 */
export function Keyed<T extends Key>({ value, children }: { value: () => T; children: (value: T) => ReelyNode }): Node {
  return (
    <For each={() => [value()]} by={(v) => String(v)}>
      {(v) => children(v())}
    </For>
  );
}
