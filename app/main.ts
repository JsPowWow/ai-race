// AI Race — точка входа: вкладки, строка чемпиона и кадровый цикл.
import './dev.ts';
import { isString, messageOf } from '@reely/basics';
import { readPalette } from '../engine/draw/render.ts';
import { drawChart } from '../engine/draw/netviz.ts';
import { checkBrain, type Brain } from '../engine/net/brain.ts';
import { state, on, persist, sizesOf, brainTitle, type TabId } from './state.ts';
import { restoreEdits, endCodeStartup } from './student-code.ts';
import { renderLesson } from './lesson.tsx';
import { beginFrame, showBanner, hideBanner } from './stage.ts';
import { stopCountdown } from './countdown.ts';
import { steerWith } from './manual-drive.ts';
import { onStorageFull, load, save, remove } from './storage.ts';
import { startGarage } from './garage.ts';
import { $$ } from './ui.ts';
import { secs, pct } from './format.ts';
import { element } from './dom.ts';
import { initTheme } from './theme.ts';
import { trainTab, updateTraining, isTraining, redrawLeaderBrain } from './tabs/train.tsx';
import { codeTab, runAllTests } from './tabs/code.tsx';
import { examTab } from './tabs/exam.tsx';
import { raceTab } from './tabs/race.tsx';
import { introTab, redrawIntro } from './tabs/intro.tsx';
import { teachTab, redrawLoss, renderNetwork } from './tabs/teach.tsx';
import { profileTab, redrawProfileBrain } from './tabs/profile.tsx';
import { listen } from '@reely/dommy-kit';

/** Вкладка: enter() — её открыли, frame() — нарисовать кадр (зовётся, пока она открыта) */
export type Tab = { enter(): void; frame(frameNo: number): void };
/** Финал: его код (Worker, печать, экспорт) нужен только кураторам — грузим, когда вкладку открыли */
type FinalModule = { finalTab: Tab; leaveFinal(): void };

const TABS: Record<Exclude<TabId, 'final'>, Tab> = { intro: introTab, profile: profileTab, teach: teachTab, train: trainTab, code: codeTab, exam: examTab, race: raceTab };
let finalModule: FinalModule | null = null;
const loadFinal = async (): Promise<FinalModule> => (finalModule ??= await import('./tabs/final.tsx'));
/** Вкладка, которая сейчас рисует кадры */
let current: Tab | null = null;
/** Старые адреса вкладок: «Гараж» и «Учитель» стали одной вкладкой «Я учу» */
const ALIASES: Record<string, TabId> = { garage: 'teach' };
const tabId = (id: string | undefined): TabId | null => {
  if (!id) return null;
  if (id in ALIASES) return ALIASES[id] ?? null;
  return id in TABS || id === 'final' ? (id as TabId) : null;
};
/** У финала нет своей кнопки в шапке: он живёт внутри «Гонки» */
const buttonOf = (id: TabId): TabId => (id === 'final' ? 'race' : id);

async function openTab(id: TabId): Promise<void> {
  const tab = id === 'final' ? (await loadFinal()).finalTab : TABS[id];
  state.tab = id;
  save('lastTab', id); // в следующий раз откроем там же
  document.body.dataset.tab = id;
  const isIntro = id === 'intro';
  element('#introPage').hidden = !isIntro;
  element('#lesson').hidden = element('.work').hidden = isIntro;
  if (!isIntro) renderLesson(id);
  for (const b of $$('.tabs button')) b.setAttribute('aria-selected', String(b.dataset.tab === buttonOf(id)));
  for (const el of $$('[data-panel]')) el.hidden = el.dataset.panel !== id;
  for (const el of $$('.toolbar')) el.hidden = el.dataset.for !== id;
  element('#viewport').hidden = id === 'code';
  element('#editor').hidden = id !== 'code';
  hideBanner();
  stopCountdown(); // ушли с гонки во время «3 — 2 — 1» — цифры не должны висеть над другой трассой
  steerWith(null); // рулить руками можно только там, где вкладка это разрешит
  if (id !== 'final') finalModule?.leaveFinal();
  current = tab;
  tab.enter();
  try {
    history.replaceState(null, '', `#${id}`);
  } catch { /* в превью истории может не быть */ }
  if (isIntro) window.scrollTo(0, 0);
}

for (const b of $$('.tabs button')) {
  listen(b, 'click', () => {
    const id = tabId(b.dataset.tab);
    if (id) openTab(id);
  });
}
listen(element('[data-home]'), 'click', (e) => {
  e.preventDefault();
  openTab('intro');
});
listen(window, 'hashchange', () => {
  const id = tabId(location.hash.slice(1));
  if (id && id !== state.tab) openTab(id);
});
// Кнопки «открыть вкладку» внутри панелей и титульной: data-open, data-go, data-start
listen(document, 'click', (e) => {
  const button = e.target instanceof Element ? e.target.closest<HTMLElement>('.panel [data-open], #introPage [data-start], #introPage [data-go]') : null;
  if (!button) return;
  const id = tabId(button.dataset.open ?? button.dataset.go ?? 'teach');
  if (!id) return;
  openTab(id);
  if (!button.dataset.open) window.scrollTo(0, 0);
});
// Файл, брошенный мимо «Гонки» и финала, браузер открыл бы вместо сайта — и всё несохранённое пропало бы.
// Там, где файлы ждут, их ловят свои обработчики раньше (они сами отменяют действие браузера)
for (const type of ['dragover', 'drop'] as const) listen(window, type, (e) => e.preventDefault());

onStorageFull(() => showBanner('Память браузера переполнена: новое не сохранится. Удали лишние заезды на вкладке «Я учу».', 6000));

// ── строка чемпиона в шапке ──

const chip = element('#champChip');
const bold = (text: string) => Object.assign(document.createElement('b'), { textContent: text });
let chipText = '';

function renderChampion(): void {
  const parts: (string | Node)[] = [];
  if (!state.champion) {
    parts.push('Мозг не обучен');
  } else {
    parts.push('Мозг: ', bold(brainTitle()));
    const last = state.history.at(-1);
    if (last && state.generation > 0 && !state.handEdited) {
      parts.push(...(last.finished ? [' · доехал за ', bold(secs(last.ticks))] : [' · проехал ', bold(pct(last.progressPct))]));
    }
    if (isTraining()) parts.push(' · ', bold('рой учит'));
  }
  const text = parts.map((p) => (isString(p) ? p : p.textContent)).join('');
  if (text === chipText) return; // зовём дважды в секунду — страницу трогаем, только когда текст другой
  chipText = text;
  chip.replaceChildren(...parts);
}
on('champion', renderChampion);

// ── кадровый цикл ──

let frameNo = 0;
function frame(): void {
  frameNo++;
  try {
    beginFrame();
    updateTraining(); // эволюция идёт в фоне на любой вкладке
    current?.frame(frameNo);
    if (frameNo % 30 === 0) renderChampion();
  } catch (e) {
    console.error(e);
    showBanner(`Ошибка: ${messageOf(e)}`, 3000);
  }
  requestAnimationFrame(frame);
}

// Холсты с графиками перерисовываем при смене размера, темы и после загрузки шрифтов
function redrawCharts(): void {
  readPalette();
  if (state.tab === 'intro') redrawIntro();
  if (state.tab === 'train') redrawLeaderBrain();
  if (state.tab === 'profile') redrawProfileBrain();
  if (state.tab === 'teach') {
    renderNetwork();
    redrawLoss();
  }
  if (state.tab === 'train') drawChart(element<HTMLCanvasElement>('#chart'), state.history);
}
new ResizeObserver(redrawCharts).observe(document.body);
initTheme(redrawCharts);
document.fonts.ready.then(redrawCharts);

// ── старт ──

/** Один раз: ученик со старой вкладки «Учитель» — в историю мозга */
function migrateOldData(): void {
  const student = load<Brain | null>('teachStudent', null);
  if (!student) return;
  remove('teachStudent');
  if (checkBrain(student, sizesOf())) return; // другой формы — на нём не поехать
  state.versions = [{
    id: 'old-student', at: new Date().toISOString(), pinned: true,
    brain: student, config: { ...structuredClone(state.config), think: 'smooth' }, generation: 0, handEdited: false,
    brainNote: 'ученик со старой вкладки «Учитель»',
  }, ...state.versions];
  persist();
}

const { failed: failedEdits, frozen } = restoreEdits(); // если код студента здесь зависнет,
runAllTests();                                          // при следующей загрузке правки отключатся
endCodeStartup();
readPalette();
// Сначала садимся в свою машину гаража (хранилище браузера отвечает не сразу), потом открываем вкладку
startGarage().catch((e: unknown) => {
  console.error(e);
  showBanner(`Гараж не открылся: ${messageOf(e)}`, 5000);
}).finally(() => {
  migrateOldData();
  renderChampion();
  openTab(tabId(location.hash.slice(1)) ?? tabId(load<string>('lastTab', 'intro')) ?? 'intro'); // впервые — титульная, потом — где остановился
});
if (frozen) showBanner('Прошлый раз код завис — твои правки отключены, вернули исходные файлы', 6000);
else if (failedEdits.length) showBanner(`Сохранённые правки не применились: ${failedEdits[0]}`, 4000);
requestAnimationFrame(frame);
