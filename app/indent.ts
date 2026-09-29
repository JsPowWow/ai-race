// Tab и Shift+Tab в редакторе кода — как в настоящем редакторе:
// просто курсор — Tab вставляет два пробела;
// что-то выделено — сдвигаются целиком все строки выделения (раньше выделенное заменялось пробелами — так пропадал код).
// Чистая функция без страницы: её легко проверить тестом (test/app/code.test.mjs).

const INDENT = '  ';

/** Что поменять: text вместо value.slice(start, end), потом выделить [selStart, selEnd) */
export type IndentEdit = { start: number; end: number; text: string; selStart: number; selEnd: number };

/** Правка для Tab (outdent = false) или Shift+Tab (outdent = true); null — менять нечего */
export function indentEdit(value: string, selStart: number, selEnd: number, outdent: boolean): IndentEdit | null {
  if (!outdent && selStart === selEnd) {
    return { start: selStart, end: selEnd, text: INDENT, selStart: selStart + INDENT.length, selEnd: selStart + INDENT.length };
  }
  // строки, которых касается выделение; если оно кончилось на переводе строки, следующая строка — не в счёт
  const start = value.lastIndexOf('\n', selStart - 1) + 1;
  const lastChar = selEnd > selStart && value[selEnd - 1] === '\n' ? selEnd - 1 : selEnd;
  const lineEnd = value.indexOf('\n', lastChar);
  const end = lineEnd === -1 ? value.length : lineEnd;
  const lines = value.slice(start, end).split('\n');
  const shifted = lines.map((line) => (outdent ? line.replace(/^ {1,2}/, '') : line && INDENT + line));
  const text = shifted.join('\n');
  if (text === value.slice(start, end)) return null;
  const firstShift = shifted[0].length - lines[0].length;
  const newStart = selStart === start ? start : Math.max(start, selStart + firstShift);
  return { start, end, text, selStart: newStart, selEnd: Math.max(newStart, selEnd + text.length - (end - start)) };
}
