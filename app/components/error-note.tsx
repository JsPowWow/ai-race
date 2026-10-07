// Ошибка под кнопками: видна, только когда есть что сказать, и читалка экрана её объявит.
type ErrorNoteProps = {
  id?: string;
  /** Текст или строки (по строке на плохой файл); пусто — заметки не видно */
  text: () => string | readonly string[];
  /** 'status' — спокойное предупреждение, читалка дождётся паузы; по умолчанию 'alert' — сразу */
  role?: 'alert' | 'status';
};

export function ErrorNote({ id, text, role = 'alert' }: ErrorNoteProps): Node {
  const shown = () => [text()].flat().join('\n');
  return <p className="error" id={id} aria={{ role }} hidden={() => !shown()}>{shown}</p>;
}
