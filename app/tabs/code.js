// Вкладка «Код» (мастерская): редактор файлов student/ и проверки к ним.
import { FILES, live, evalAvailable, getSource, applySource, resetSource, isEdited } from '../student-code.js';
import { runTests } from '../tests.js';
import { emit } from '../state.js';
import { $, esc, delegate } from '../ui.js';

const STATUS_LABEL = { pass: 'OK', advice: 'Совет', fail: 'Ошибка' };

let file = 'fitness';
const results = {};

export const codeTab = {
  enter: render,
  frame() {},
};

export function runAllTests() {
  for (const f of FILES) results[f.id] = runTests(f.id, live[f.id]);
}

const worst = (list = []) => ['fail', 'advice'].find((s) => list.some((r) => r.status === s)) ?? 'pass';

function render() {
  const meta = FILES.find((f) => f.id === file);
  const editable = evalAvailable();
  renderFileTabs();
  Object.assign($('#codeEditor'), { value: getSource(file), readOnly: !editable });
  $('#codeApply').disabled = !editable;
  $('#evalNote').hidden = editable;
  $('#codeTitle').textContent = `${meta.file} · ${meta.title}`;
  $('#codeTask').textContent = meta.task;
  $('#codeMsg').textContent = isEdited(file) ? 'Файл изменён' : '';
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

$('#codeEditor').addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    e.target.setRangeText('  ', e.target.selectionStart, e.target.selectionEnd, 'end');
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    $('#codeApply').click();
  }
});

$('#codeApply').addEventListener('click', () => {
  try {
    applySource(file, $('#codeEditor').value);
    codeChanged(`Применено. ${file === 'controls' ? 'Проверь в «Гараже».' : 'Новое поколение возьмёт этот код.'}`);
  } catch (e) {
    $('#codeMsg').textContent = `Не получилось: ${e.message}`;
  }
});

$('#codeReset').addEventListener('click', () => {
  resetSource(file);
  $('#codeEditor').value = getSource(file);
  codeChanged('Вернули исходный файл');
});
