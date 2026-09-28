// «Гонка», проверка чужого кода.
// Свой вариант мозга из чужого файла — это код, который выполнится у тебя в браузере.
// Поэтому он не запускается сам: преподаватель читает его и нажимает «Разрешить».
// Здесь только показ и подсказки; разрешает (компилирует код) — app/car-file.js, approveCode().

/** Чему в честном мозге делать нечего: страница, сеть, хранилище, подмена Math, вечные циклы */
const SUSPICIOUS = /\b(window|self|globalThis|document|localStorage|sessionStorage|indexedDB|fetch|XMLHttpRequest|WebSocket|navigator|location|eval|Function|constructor|prototype|__proto__|import|setTimeout|setInterval|postMessage)\b|while\s*\(\s*(true|1)\s*\)|for\s*\(\s*;\s*;\s*\)|Math\.\w+\s*=[^=]/;

/** Номера подозрительных строк (с 1) */
export const suspiciousLines = (code: string): number[] =>
  code.split('\n').flatMap((line, i) => (SUSPICIOUS.test(line) ? [i + 1] : []));

/** Кого проверяем: имя участника и текст его think.js */
export type Reviewed = { name: string; code: string };

type ReviewProps = { entrant: Reviewed; onAllow: () => void; onReject: () => void };

/** Код участника с номерами строк; подозрительные подсвечены. Рисуется заново для каждого участника */
export function Review({ entrant, onAllow, onReject }: ReviewProps): Node {
  const lines = entrant.code.split('\n');
  const flagged = suspiciousLines(entrant.code);
  return (
    <div className="review" id="rReview" elementRef={(el) => queueMicrotask(() => el.scrollIntoView({ block: 'nearest' }))}>
      <h3 id="rReviewTitle">Код участника «{entrant.name}»</h3>
      <p className="hint">Участник написал свой вариант мозга. Этот код выполнится у тебя в браузере, поэтому сначала прочитай его. Без разрешения машина в гонке не участвует.</p>
      <pre className="review-code" id="rReviewCode">
        {lines.flatMap((line, i) => [
          i ? '\n' : '',
          <span className={flagged.includes(i + 1) ? 'sus' : ''}>{`${String(i + 1).padStart(3)}  ${line}`}</span>,
        ])}
      </pre>
      <p className={flagged.length ? 'hint error' : 'hint'} id="rReviewFlags">
        {flagged.length
          ? `Внимание, строки ${flagged.join(', ')}: здесь обращение к странице, сети, хранилищу или возможный бесконечный цикл. Честному мозгу это не нужно — такой код лучше отклонить.`
          : 'Подозрительного не нашлось. Всё равно прочитай: разрешай, только если понятно, что делает каждая строка.'}
      </p>
      <div className="row">
        <button className="btn small primary" id="rReviewAllow" onClick={onAllow}>Разрешить</button>
        <button className="btn small danger" id="rReviewReject" onClick={onReject}>Отклонить и убрать</button>
      </div>
    </div>
  );
}
