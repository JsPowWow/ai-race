// Вкладка «Код» (урок 3): редактор файлов student/ и проверки к ним.
import { FILES, live, evalAvailable, getSource, applySource, resetSource, isEdited, errorLine, beginCodeStartup, endCodeStartup } from '../student-code.ts';
import { runTests } from '../tests.js';
import { emit } from '../state.ts';
import { $, esc, delegate } from '../ui.ts';

const STATUS_LABEL = { pass: 'OK', advice: 'Совет', fail: 'Ошибка' };

let file = 'fitness';
let errorAt = null; // строка с ошибкой в открытом файле
const results = {};

export const codeTab = {
  enter: render,
  frame() {},
};

export function runAllTests() {
  for (const f of FILES) results[f.id] = runTests(f.id, live[f.id]);
}

const worst = (list = []) => ['fail', 'advice'].find((s) => list.some((r) => r.status === s)) ?? 'pass';
const editor = () => $('#codeEditor');

function render() {
  const meta = FILES.find((f) => f.id === file);
  const editable = evalAvailable();
  renderFileTabs();
  Object.assign(editor(), { value: getSource(file), readOnly: !editable });
  $('#codeApply').disabled = !editable;
  $('#evalNote').hidden = editable;
  $('#codeTitle').textContent = `${meta.file} · ${meta.title}`;
  $('#codeTask').textContent = meta.task;
  $('#codeMsg').textContent = isEdited(file) ? 'Файл изменён' : '';
  showError(null);
  renderTests();
}

function renderFileTabs() {
  $('#fileTabs').innerHTML = FILES.map((f) => `
    <button role="tab" aria-selected="${f.id === file}" data-file="${f.id}">
      <span class="dot ${worst(results[f.id])}" aria-hidden="true"></span>${f.file}${isEdited(f.id) ? ' •' : ''}
    </button>`).join('');
}

function renderTests() {
  $('#testList').innerHTML = (results[file] ?? []).map((r) => `
    <li>
      <span class="badge ${r.status}">${STATUS_LABEL[r.status]}</span>
      <span>${esc(r.name)}${r.msg ? `<span class="msg">${esc(r.msg)}</span>` : ''}</span>
    </li>`).join('');
}

// ── номера строк и ошибки ──

function renderGutter() {
  const count = editor().value.split('\n').length;
  $('#codeGutter').innerHTML = Array.from({ length: count }, (_, i) =>
    (i + 1 === errorAt ? `<span class="bad">${i + 1}</span>` : String(i + 1))).join('\n');
  $('#codeGutter').scrollTop = editor().scrollTop;
}

/** Понятное объяснение самых частых ошибок */
function explain(error) {
  const text = error.message;
  if (error.kind === 'syntax') return 'Код написан с ошибкой: проверь скобки, запятые и кавычки в этой строке или строкой выше.';
  if (error.kind === 'contract') return 'Файл должен экспортировать нужную функцию — например, export function fitness(car) { … }.';
  if (/is not defined/.test(text)) return 'Такого имени нет: опечатка или переменная не объявлена. Внешние объекты вроде window и fetch здесь отключены.';
  if (/Cannot read properties of (undefined|null)/.test(text)) return 'Берёшь свойство у того, чего нет (undefined). Проверь имя поля.';
  if (/is not a function/.test(text)) return 'Это не функция — проверь имя и скобки.';
  return 'Исправь код и нажми «Применить» ещё раз.';
}

function showError(error) {
  const box = $('#codeError');
  errorAt = error ? errorLine(error) : null;
  $('.code-box').classList.toggle('has-error', !!error);
  box.hidden = !error;
  if (error) {
    const lineText = errorAt ? editor().value.split('\n')[errorAt - 1] ?? '' : '';
    box.innerHTML = `
      <b>${errorAt ? `Ошибка в строке ${errorAt}` : 'Ошибка в коде'}</b>
      <span class="msg">${esc(error.message)}</span>
      ${errorAt ? `<pre>${esc(`${errorAt} | ${lineText}`)}</pre>` : ''}
      <span class="hint">${esc(explain(error))}</span>`;
    if (errorAt) goToLine(errorAt);
    box.scrollIntoView({ block: 'nearest' });
  }
  renderGutter();
}

function goToLine(line) {
  const ed = editor();
  const lines = ed.value.split('\n');
  const start = lines.slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0);
  ed.focus({ preventScroll: true });
  ed.setSelectionRange(start, start + (lines[line - 1]?.length ?? 0));
  const lineHeight = parseFloat(getComputedStyle(ed).lineHeight) || 20;
  ed.scrollTop = Math.max(0, (line - 4) * lineHeight);
}

/** Код поменялся: перепроверить и сообщить остальным вкладкам */
function codeChanged(message) {
  runAllTests();
  emit('code', file);
  renderFileTabs();
  renderTests();
  $('#codeMsg').textContent = message;
}

delegate('#fileTabs', 'click', '[data-file]', (button) => {
  file = button.dataset.file;
  render();
});

editor().addEventListener('scroll', () => ($('#codeGutter').scrollTop = editor().scrollTop));
editor().addEventListener('input', renderGutter);
editor().addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    e.target.setRangeText('  ', e.target.selectionStart, e.target.selectionEnd, 'end');
    renderGutter();
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    $('#codeApply').click();
  }
});

$('#codeApply').addEventListener('click', () => {
  try {
    beginCodeStartup(); // зависнет прямо сейчас — после перезагрузки правки отключатся
    applySource(file, editor().value);
    showError(null);
    emit('did', `code:${file}`);
    codeChanged(`Применено. ${file === 'controls' ? 'Проверь на «Я учу».' : 'Новое поколение возьмёт этот код.'}`);
  } catch (e) {
    showError(e);
    $('#codeMsg').textContent = 'Не применено: сначала исправь ошибку';
  } finally {
    endCodeStartup();
  }
});

$('#codeReset').addEventListener('click', () => {
  resetSource(file);
  editor().value = getSource(file);
  showError(null);
  codeChanged('Вернули исходный файл');
});
