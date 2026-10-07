// Вкладка «Код» (урок 3): редактор файлов student/ и проверки к ним.
// Редактор (над трассой) и панель справа — на @reely/dommy (#20). Текст в редакторе — обычная <textarea>:
// её содержимое не привязано к сигналу, чтобы не сбивать курсор; сигналы — вокруг: номера строк, ошибка, проверки.
import { mount, signal, For, Show } from '@reely/dommy';
import { pre, textarea } from '@reely/dommy';
import { withOwner } from '@reely/signals';
import { FILES, live, evalAvailable, getSource, originalSource, applySource, resetSource, isEdited, errorLine, beginCodeStartup, endCodeStartup } from '../student-code.ts';
import { runTests } from '../tests.ts';
import type { TestResult, TestStatus } from '../tests.ts';
import { emit } from '../state.ts';
import { element } from '../dom.ts';
import { indentEdit } from '../indent.ts';
import { messageOf } from '@reely/basics';

type FileMeta = (typeof FILES)[number];

const STATUS_LABEL: Record<TestStatus, string> = { pass: 'OK', advice: 'Совет', fail: 'Ошибка' };
/** Что сказать после «Применить»: где увидеть новый код в деле */
const AFTER_APPLY: Record<string, string> = {
  controls: 'Проверь на «Я учу».',
  think: 'Вариант мозга выбирается на «Профиле» или в «Рецепте роя».',
};

/** Здесь можно запускать свой код? (на некоторых страницах new Function запрещён) */
const canEdit = evalAvailable();

// ── состояние вкладки ──

/** Открытый файл */
const file = signal<FileMeta>(FILES[0]);
/** Итоги проверок и «файл изменён» — по каждому файлу; пересчитывает runAllTests() */
const checks = signal<Record<string, { results: TestResult[]; edited: boolean }>>({});
/** Текст в редакторе сейчас (для номеров строк и кнопок) */
const text = signal('');
/** Неприменённые правки по файлам: ушёл на другой файл или вкладку — вернёшься, а они на месте */
const drafts = new Map<string, string>();
/** Ошибка в коде, которую показываем над редактором */
const error = signal<{ line: number | null; message: string; hint: string; lineText: string } | null>(null);
/** Что получилось: «Применено…», «Не применено…» */
const message = signal('');
/** «Вернуть исходный» ждёт подтверждения: правки пропадут */
const confirmingReset = signal(false);

const resultsOf = (id: string): TestResult[] => checks.value[id]?.results ?? [];
/** Хуже всего, что есть в проверках файла: от этого цвет точки на ярлыке */
const worst = (list: TestResult[]): TestStatus => (['fail', 'advice'] as const).find((s) => list.some((r) => r.status === s)) ?? 'pass';
/** Есть что терять при «Вернуть исходный»: сохранённые правки или текст, который ещё не применили */
const hasChanges = () => !!checks.value[file.value.id]?.edited || text.value !== originalSource(file.value.id);

/** Проверить все файлы заново (при запуске и после каждой правки) */
export function runAllTests(): void {
  checks.value = Object.fromEntries(FILES.map((f) => [f.id, { results: runTests(f.id, live[f.id as keyof typeof live]), edited: isEdited(f.id) }]));
}

// ── редактор ──

// Фабрики тегов возвращают сам элемент с точным типом: курсором и прокруткой управляем напрямую.
// Редактор живёт, пока открыта страница: withOwner — его собственный владелец (иначе dommy предупредит об утечке)
const editor = withOwner(() => textarea({
  id: 'codeEditor', spellcheck: false, autocomplete: 'off', autocapitalize: 'off', wrap: 'off', readOnly: !canEdit,
  aria: { ariaLabel: () => `Код: ${file.value.file}`, ariaDescribedby: 'codeError' },
  onInput: () => edited(),
  onScroll: () => syncGutter(),
  onKeyDown: (e) => onKey(e),
}));
const gutter = pre({ className: 'gutter', id: 'codeGutter', aria: { ariaHidden: true } });
/** Номера строк: у строки с ошибкой — красная плашка */
const lineNumbers = () => Array.from({ length: text.value.split('\n').length }, (_, i) => i + 1);
mount(gutter, () => (
  <For each={lineNumbers} by={(n) => n}>
    {(n) => (
      <>
        {n() > 1 ? '\n' : ''}
        <span className={() => (n() === error.value?.line ? 'bad' : null)}>{n}</span>
      </>
    )}
  </For>
));

const syncGutter = () => (gutter.scrollTop = editor.scrollTop);

/** Текст в редакторе поменялся руками */
function edited(): void {
  text.value = editor.value;
  drafts.set(file.value.id, editor.value);
  confirmingReset.value = false;
  syncGutter();
}

/** Показать файл: неприменённые правки, если они есть, иначе то, что сейчас работает */
function openFile(meta: FileMeta): void {
  file.value = meta;
  const draft = drafts.get(meta.id);
  editor.value = draft ?? getSource(meta.id);
  editor.scrollTop = 0;
  text.value = editor.value;
  error.value = null;
  confirmingReset.value = false;
  message.value = draft !== undefined && draft !== getSource(meta.id) ? 'Правки ещё не применены' : isEdited(meta.id) ? 'Файл изменён' : '';
  syncGutter();
}

// Tab — отступ (выделено несколько строк — сдвигаются все); Esc, потом Tab — уйти из редактора к кнопкам.
// Ctrl+Enter (⌘+Enter) — «Применить».
let tabLeaves = false;
function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') tabLeaves = true;
  if (e.key === 'Tab' && !tabLeaves && !editor.readOnly) {
    e.preventDefault();
    const edit = indentEdit(editor.value, editor.selectionStart, editor.selectionEnd, e.shiftKey);
    if (edit) replaceText(edit.start, edit.end, edit.text, edit.selStart, edit.selEnd);
  }
  if (e.key !== 'Escape') tabLeaves = false;
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    apply();
  }
}

/** Заменить кусок текста так, чтобы Ctrl+Z его отменял */
function replaceText(start: number, end: number, insert: string, selStart: number, selEnd: number): void {
  editor.setSelectionRange(start, end);
  // execCommand устарел, но только он кладёт правку в историю «Отменить» у <textarea>
  const done = document.execCommand('insertText', false, insert);
  if (!done) {
    editor.setRangeText(insert, start, end, 'end');
    edited();
  }
  editor.setSelectionRange(selStart, selEnd);
}

/** Понятное объяснение самых частых ошибок */
function explain(e: unknown): string {
  const kind = (e as { kind?: string } | null)?.kind; // CodeError из student-code.js знает, какая это ошибка
  const text = messageOf(e);
  if (kind === 'syntax') return 'Код написан с ошибкой: проверь скобки, запятые и кавычки в этой строке или строкой выше.';
  if (kind === 'contract') return 'Файл должен экспортировать нужную функцию — например, export function fitness(car) { … }.';
  if (/is not defined/.test(text)) return 'Такого имени нет: опечатка или переменная не объявлена. Внешние объекты вроде window и fetch здесь отключены.';
  if (/Cannot read properties of (undefined|null)/.test(text)) return 'Берёшь свойство у того, чего нет (undefined). Проверь имя поля.';
  if (/is not a function/.test(text)) return 'Это не функция — проверь имя и скобки.';
  return 'Исправь код и нажми «Применить» ещё раз.';
}

/** Показать ошибку над редактором и выделить строку с ней */
function showError(e: unknown): void {
  const line = errorLine(e);
  error.value = {
    line,
    message: messageOf(e),
    hint: explain(e),
    lineText: line ? (editor.value.split('\n')[line - 1] ?? '') : '',
  };
  if (line) goToLine(line);
  element('#codeError').scrollIntoView({ block: 'nearest' });
}

function goToLine(line: number): void {
  const lines = editor.value.split('\n');
  const start = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
  editor.focus({ preventScroll: true });
  editor.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0));
  const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 20;
  editor.scrollTop = Math.max(0, (line - 4) * lineHeight);
  syncGutter();
}

/** Код поменялся: перепроверить и сообщить остальным вкладкам */
function codeChanged(id: string, note: string): void {
  drafts.delete(id);
  error.value = null;
  runAllTests();
  emit('code', id);
  message.value = note;
}

function apply(): void {
  if (!canEdit) return;
  const { id } = file.value;
  try {
    beginCodeStartup(); // зависнет прямо сейчас — после перезагрузки правки отключатся
    applySource(id, editor.value);
    emit('did', `code:${id}`);
    codeChanged(id, `Применено. ${AFTER_APPLY[id] ?? 'Новое поколение возьмёт этот код.'}`);
  } catch (e) {
    showError(e);
    message.value = 'Не применено: сначала исправь ошибку';
  } finally {
    endCodeStartup();
  }
}

function reset(): void {
  const { id } = file.value;
  confirmingReset.value = false;
  resetSource(id);
  editor.value = getSource(id);
  text.value = editor.value;
  codeChanged(id, 'Вернули исходный файл');
}

function FileTabs(): Node {
  return (
    <div className="filetabs" id="fileTabs" role="tablist" aria={{ ariaLabel: 'Файлы студента' }}>
      {FILES.map((meta) => (
        <button role="tab" aria={{ ariaSelected: () => file.value === meta }} onClick={() => openFile(meta)}>
          <span className={() => `dot ${worst(resultsOf(meta.id))}`} aria={{ ariaHidden: true }} />
          {meta.file}
          {() => (checks.value[meta.id]?.edited ? ' •' : '')}
        </button>
      ))}
    </div>
  );
}

function ErrorBox(): Node {
  return (
    <div className="code-error" id="codeError" role="alert" hidden={() => !error.value}>
      <Show when={error}>
        {() => (
          <>
            <b>{() => (error.value?.line ? `Ошибка в строке ${error.value.line}` : 'Ошибка в коде')}</b>
            <span className="msg">{() => error.value?.message}</span>
            <Show when={() => error.value?.line}>
              {() => <pre>{() => `${error.value?.line} | ${error.value?.lineText}`}</pre>}
            </Show>
            <span className="hint">{() => error.value?.hint}</span>
          </>
        )}
      </Show>
    </div>
  );
}

function Buttons(): Node {
  return (
    <Show when={confirmingReset}
      fallback={() => (
        <div className="row">
          <button className="btn primary" id="codeApply" disabled={!canEdit} onClick={apply}>Применить</button>
          <button className="btn" id="codeReset" disabled={() => !hasChanges()} onClick={() => (confirmingReset.value = true)}>Вернуть исходный</button>
          <span className="note" id="codeMsg" role="status">{message}</span>
        </div>
      )}>
      {() => (
        <div className="pending">
          <p>{() => `Твои правки в ${file.value.file} пропадут — вернётся файл, каким он был в начале курса.`}</p>
          <div className="row">
            <button className="btn small danger" id="codeResetYes" onClick={reset}>Вернуть исходный</button>
            <button className="btn small" onClick={() => (confirmingReset.value = false)}>Отмена</button>
          </div>
        </div>
      )}
    </Show>
  );
}

mount(element('#editor'), () => (
  <>
    <FileTabs />
    <ErrorBox />
    <div className={() => (error.value ? 'code-box has-error' : 'code-box')}>
      {gutter}
      {editor}
    </div>
    <Buttons />
  </>
));

// ── панель справа: задание и проверки ──

function TestRow({ result }: { result: () => TestResult }): Node {
  return (
    <li>
      <span className={() => `badge ${result().status}`}>{() => STATUS_LABEL[result().status]}</span>
      <span>
        {() => result().name}
        <Show when={() => result().msg}>{() => <span className="msg">{() => result().msg}</span>}</Show>
      </span>
    </li>
  );
}

mount(element('#codePanel'), () => (
  <>
    <section className="block">
      <h2 id="codeTitle">{() => `${file.value.file} · ${file.value.title}`}</h2>
      <p id="codeTask">{() => file.value.task}</p>
      <p className="error" id="evalNote" hidden={canEdit}>Здесь нельзя запускать отредактированный код. Правьте файлы в папке <code>student/</code> и обновите страницу.</p>
    </section>
    <section className="block">
      <h2>Проверки</h2>
      <ul className="tests" id="testList">
        <For each={() => resultsOf(file.value.id)} by={(r) => r.name}>{(result) => <TestRow result={result} />}</For>
      </ul>
      <p className="legend"><span className="badge pass">OK</span> работает <span className="badge advice">Совет</span> можно лучше <span className="badge fail">Ошибка</span> надо чинить</p>
    </section>
  </>
));

export const codeTab = {
  enter() {
    // вернулись на вкладку — всё как было: неприменённые правки, курсор, прокрутка. Заново — только если файл поменялся без нас
    const { id } = file.value;
    if (editor.value !== (drafts.get(id) ?? getSource(id))) openFile(file.value);
  },
  frame() {},
};
