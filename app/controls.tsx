// Переключатели для панелей на @reely/dommy (#20): «одно из» кнопками и выпадающий список.
// Выбор приходит функцией value() — переключатель сам следит за ним; что делать при выборе — pick().
import { For } from '@reely/dommy';

/** Вариант выбора: id — что запомнить, title — что показать */
export type Choice<T extends string | number = string> = { id: T; title: string };

type SegProps<T extends string | number> = { label: string; items: readonly Choice<T>[]; value: () => T; pick: (id: T) => void };

/** Кнопки «одно из» (класс seg): нажата та, что выбрана сейчас */
export function Seg<T extends string | number>({ label, items, value, pick }: SegProps<T>): Node {
  return (
    <div className="seg" aria={{ role: 'group', ariaLabel: label }}>
      {items.map(({ id, title }) => (
        <button aria={{ ariaPressed: () => String(value() === id) }} onClick={() => pick(id)}>{title}</button>
      ))}
    </div>
  );
}

type SelectProps = { id?: string; label?: string; items: readonly Choice[] | (() => readonly Choice[]); value: () => string; pick: (id: string) => void };

/**
 * Выпадающий список. Выбранный вариант отмечаем у самого option (selected): value у select, заданное
 * до того, как в нём появились варианты, браузер пропустит. items — список или функция, если варианты меняются.
 */
export function Select({ id, label, items, value, pick }: SelectProps): Node {
  const list = typeof items === 'function' ? items : () => items;
  return (
    <select id={id} aria={label ? { ariaLabel: label } : {}} onChange={(e) => pick(e.currentTarget.value)}>
      <For each={list} by={(item) => item.id}>
        {(item) => <option value={() => item().id} selected={() => item().id === value()}>{() => item().title}</option>}
      </For>
    </select>
  );
}
