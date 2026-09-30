// Текст с кусочками кода: `в обратных кавычках` — <code>, остальное — обычный текст.
// Так тексты уроков остаются простыми строками без HTML, а на страницу всё равно попадает только текст.
import { isString } from '@reely/basics';
import { Keyed } from '@reely/dommy';
import type { ReelyNode } from '@reely/dommy';

/** Нечётные куски между обратными кавычками — код */
const parts = (text: string): ReelyNode[] => text.split('`').map((part, i) => (i % 2 ? <code>{part}</code> : part));

/** text — строка или функция, которая её возвращает (тогда текст перестраивается, когда она поменялась) */
export function TextWithCode({ text }: { text: string | (() => string) }): Node {
  return isString(text) ? <>{parts(text)}</> : <Keyed value={text}>{parts}</Keyed>;
}
