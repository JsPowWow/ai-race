// AI Race — точка входа: вкладки, строка чемпиона и кадровый цикл.
import { readPalette } from '../engine/render.ts';
import { drawChart } from '../engine/netviz.ts';
import { state, on, persist, sizesOf, brainTitle } from './state.js';
import { restoreEdits, endCodeStartup } from './student-code.js';
import { renderLesson } from './lesson.js';
import { beginFrame, showBanner, hideBanner } from './stage.js';
import { steerWith } from './manual-drive.js';
import { onStorageFull, load, save, remove } from './storage.js';
import { startGarage } from './garage.js';
import { checkBrain } from '../engine/brain.ts';
import { $, $$, esc, secs, pct, delegate } from './ui.js';
import { trainTab, updateTraining, isTraining, redrawLeaderBrain } from './tabs/train.js';
import { codeTab, runAllTests } from './tabs/code.js';
import { examTab } from './tabs/exam.js';
import { raceTab } from './tabs/race.js';
import { introTab, redrawIntro } from './tabs/intro.js';
import { initTheme } from './theme.js';
import { teachTab, redrawLoss, renderNetwork } from './tabs/teach.js';
import { profileTab, redrawProfileBrain } from './tabs/profile.tsx';
import { mount } from '@reely/dommy';
import { BrainLibrary } from './library-view.tsx';

const TABS = { intro: introTab, profile: profileTab, teach: teachTab, train: trainTab, code: codeTab, exam: examTab, race: raceTab };
/** Финал нужен только кураторам: его код (Worker, печать, экспорт) грузим, когда вкладку открыли */
let finalModule = null;
const loadFinal = async () => (finalModule ??= await import('./tabs/final.js'));
/** Вкладка, которая сейчас рисует кадры */
let current = null;
/** Старые адреса вкладок: «Гараж» и «Учитель» стали одной вкладкой «Я учу» */
const ALIASES = { garage: 'teach' };
const tabId = (id) => ALIASES[id] ?? (id in TABS || id === 'final' ? id : null);
/** У финала нет своей кнопки в шапке: он живёт внутри «Гонки» */
const TAB_BUTTON = { final: 'race' };

async function openTab(id) {
  const tab = id === 'final' ? (await loadFinal()).finalTab : TABS[id];
  state.tab = id;
  save('lastTab', id); // в следующий раз откроем там же
  document.body.dataset.tab = id;
  const isIntro = id === 'intro';
  $('#introPage').hidden = !isIntro;
  $('#lesson').hidden = $('.work').hidden = isIntro;
  if (!isIntro) renderLesson(id);
  for (const b of $$('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === (TAB_BUTTON[id] ?? id)));
  for (const el of $$('[data-panel]')) el.hidden = el.dataset.panel !== id;
  for (const el of $$('.toolbar')) el.hidden = el.dataset.for !== id;
  $('#viewport').hidden = id === 'code';
  $('#editor').hidden = id !== 'code';
  hideBanner();
  steerWith(null); // рулить руками можно только там, где вкладка это разрешит
  if (id !== 'final') finalModule?.leaveFinal();
  current = tab;
  tab.enter();
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
window.addEventListener('hashchange', () => {
  const id = tabId(location.hash.slice(1));
  if (id && id !== state.tab) openTab(id);
});
delegate('.panel', 'click', '[data-open]', (b) => openTab(b.dataset.open));
delegate('#introPage', 'click', '[data-start], [data-go]', (b) => {
  openTab(b.dataset.go ?? 'teach');
  window.scrollTo(0, 0);
});

// Блок «Мозг» с «Историей» — на «Я учу» и «Учится само»
for (const root of $$('[data-library]')) mount(root, BrainLibrary);

onStorageFull(() => showBanner('Память браузера переполнена: новое не сохранится. Удали лишние заезды на вкладке «Я учу».', 6000));

// ── строка чемпиона в шапке ──

function renderChampion() {
  if (!state.champion) {
    $('#champChip').textContent = 'Мозг не обучен';
    return;
  }
  const last = state.history.at(-1);
  const fromSwarm = state.generation > 0 && !state.handEdited && last;
  const result = fromSwarm ? (last.finished ? ` · доехал за <b>${secs(last.ticks)}</b>` : ` · проехал <b>${pct(last.progressPct)}</b>`) : '';
  $('#champChip').innerHTML = `Мозг: <b>${esc(brainTitle())}</b>${result}${isTraining() ? ' · <b>рой учит</b>' : ''}`;
}
on('champion', renderChampion);

// ── кадровый цикл ──

let frameNo = 0;
function frame() {
  frameNo++;
  try {
    beginFrame();
    updateTraining(); // эволюция идёт в фоне на любой вкладке
    current?.frame(frameNo);
    if (frameNo % 30 === 0) renderChampion();
  } catch (e) {
    console.error(e);
    showBanner(`Ошибка: ${e.message}`, 3000);
  }
  requestAnimationFrame(frame);
}

// Холсты с графиками перерисовываем при смене размера, темы и после загрузки шрифтов
function redrawCharts() {
  readPalette();
  if (state.tab === 'intro') redrawIntro();
  if (state.tab === 'train') redrawLeaderBrain();
  if (state.tab === 'profile') redrawProfileBrain();
  if (state.tab === 'teach') {
    renderNetwork();
    redrawLoss();
  }
  if (state.tab === 'train') drawChart($('#chart'), state.history);
}
new ResizeObserver(redrawCharts).observe(document.body);
initTheme(redrawCharts);
document.fonts?.ready.then(redrawCharts);

// ── старт ──

/** Один раз: ученик со старой вкладки «Учитель» — в историю мозга, галочки старых уроков 1–2 — сбросить */
function migrateOldData() {
  const student = load('teachStudent', null);
  if (student) {
    remove('teachStudent');
    if (!checkBrain(student, sizesOf())) {
      state.versions = [{
        id: 'old-student', at: new Date().toISOString(), pinned: true,
        brain: student, config: { ...structuredClone(state.config), think: 'smooth' }, generation: 0, handEdited: false,
        brainNote: 'ученик со старой вкладки «Учитель»',
      }, ...state.versions];
      persist();
    }
  }
}

const { failed: failedEdits, frozen } = restoreEdits(); // если код студента здесь зависнет,
runAllTests();                                          // при следующей загрузке правки отключатся
endCodeStartup();
readPalette();
// Сначала садимся в свою машину гаража (хранилище браузера отвечает не сразу), потом открываем вкладку
startGarage().catch((e) => {
  console.error(e);
  showBanner(`Гараж не открылся: ${e.message}`, 5000);
}).finally(() => {
  migrateOldData();
  renderChampion();
  openTab(tabId(location.hash.slice(1)) ?? tabId(load('lastTab', 'intro')) ?? 'intro'); // впервые — титульная, потом — где остановился
});
if (frozen) showBanner('Прошлый раз код завис — твои правки отключены, вернули исходные файлы', 6000);
else if (failedEdits.length) showBanner(`Сохранённые правки не применились: ${failedEdits[0]}`, 4000);
requestAnimationFrame(frame);
