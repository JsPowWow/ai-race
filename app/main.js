// AI Race — точка входа: вкладки, строка чемпиона и кадровый цикл.
import { readPalette } from '../engine/render.js';
import { drawChart } from '../engine/netviz.js';
import { state, on } from './state.js';
import { restoreEdits } from './student-code.js';
import { renderLesson } from './lesson.js';
import { beginFrame, showBanner, hideBanner } from './stage.js';
import { $, $$, secs, pct, delegate } from './ui.js';
import { load, save } from './storage.js';
import { garageTab, renderNetwork } from './tabs/garage.js';
import { trainTab, updateTraining, isTraining } from './tabs/train.js';
import { codeTab, runAllTests } from './tabs/code.js';
import { examTab } from './tabs/exam.js';
import { raceTab } from './tabs/race.js';
import { introTab, redrawIntro } from './tabs/intro.js';

const TABS = { intro: introTab, garage: garageTab, train: trainTab, code: codeTab, exam: examTab, race: raceTab };

function openTab(id) {
  state.tab = id;
  document.body.dataset.tab = id;
  const isIntro = id === 'intro';
  $('#introPage').hidden = !isIntro;
  $('#lesson').hidden = $('.work').hidden = isIntro;
  if (!isIntro) {
    renderLesson(id);
    save('introSeen', true);
  }
  for (const b of $$('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === id));
  for (const el of $$('[data-panel]')) el.hidden = el.dataset.panel !== id;
  for (const el of $$('.toolbar')) el.hidden = el.dataset.for !== id;
  $('#viewport').hidden = id === 'code';
  $('#editor').hidden = id !== 'code';
  hideBanner();
  TABS[id].enter();
  try {
    history.replaceState(null, '', `#${id}`);
  } catch { /* в превью истории может не быть */ }
  if (isIntro) window.scrollTo(0, 0);
}

for (const b of $$('.tabs button')) b.addEventListener('click', () => openTab(b.dataset.tab));
$('[data-home]').addEventListener('click', (e) => {
  e.preventDefault();
  openTab('intro');
});
delegate('#introPage', 'click', '[data-start], [data-go]', (b) => {
  openTab(b.dataset.go ?? 'garage');
  window.scrollTo(0, 0);
});

// ── строка чемпиона в шапке ──

function renderChampion() {
  if (!state.champion) {
    $('#champChip').textContent = 'Мозг не обучен';
    return;
  }
  const last = state.history.at(-1);
  const result = state.handEdited ? 'поправлен руками'
    : !last ? 'загружен'
    : last.finished ? `доехал за <b>${secs(last.ticks)}</b>`
    : `проехал <b>${pct(last.progressPct)}</b>`;
  $('#champChip').innerHTML = `Чемпион: поколение <b>${state.generation}</b> · ${result}${isTraining() ? ' · <b>учится</b>' : ''}`;
}
on('champion', renderChampion);

// ── кадровый цикл ──

let frameNo = 0;
function frame() {
  frameNo++;
  try {
    beginFrame();
    updateTraining(); // эволюция идёт в фоне на любой вкладке
    TABS[state.tab].frame(frameNo);
    if (frameNo % 30 === 0) renderChampion();
  } catch (e) {
    console.error(e);
    showBanner(`Ошибка: ${e.message}`, 3000);
  }
  requestAnimationFrame(frame);
}

// Холсты с графиками перерисовываем при смене размера и после загрузки шрифтов
function redrawCharts() {
  readPalette();
  if (state.tab === 'intro') redrawIntro();
  if (state.tab === 'garage') renderNetwork();
  if (state.tab === 'train') drawChart($('#chart'), state.history);
}
new ResizeObserver(redrawCharts).observe(document.body);
document.fonts?.ready.then(redrawCharts);

// ── старт ──

const failedEdits = restoreEdits();
runAllTests();
readPalette();
renderChampion();
const fromHash = location.hash.slice(1);
openTab(fromHash in TABS ? fromHash : load('introSeen', false) ? 'garage' : 'intro');
if (failedEdits.length) showBanner(`Сохранённые правки не применились: ${failedEdits[0]}`, 4000);
requestAnimationFrame(frame);
