// Мозг и его история.
//
// Текущий мозг (state.champion + state.config) — один на весь сайт: его учат на «Я учу» и «Учится само»,
// он сдаёт экзамен и едет на гонку. Мозг всегда хранится вместе со своей формой: сенсоры, слои, вариант.
//
// Учиться — значит продолжать с текущего мозга. Перед каждым большим изменением
// (обучение на заездах, старт роя, ручная правка, сброс, другая форма сети) текущий мозг
// сам попадает в «Историю» — к любой версии можно вернуться. звёздочка закрепляет версию навсегда,
// незакреплённых хранится HISTORY_MAX последних.
import { cloneBrain, checkBrain } from '../engine/brain.js';
import { state, persist, sizesOf, sameSizes, setChampion, resetProgress, emit, on, thinkVariant, brainTitle } from './state.js';
import { showBanner } from './stage.js';
import { $$, esc, delegate } from './ui.js';

const HISTORY_MAX = 10;
/** Значок «закрепить»: звезда; у закреплённой версии закрашена (стили — app/styles/teach.css) */
const PIN_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>';
let historyOpen = false; // раскрыта ли «История» — помним между перерисовками

const sameBrain = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Сохранить текущий мозг в историю (если он есть и ещё не лежит там последним) */
export function remember() {
  if (!state.champion) return;
  const [latest] = state.versions;
  if (latest && sameBrain(latest.brain, state.champion) && sameSizes(latest.config, state.config)) return;
  const version = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
    at: new Date().toISOString(),
    brain: cloneBrain(state.champion),
    config: structuredClone(state.config),
    generation: state.generation,
    handEdited: state.handEdited,
    brainNote: brainTitle(),
    pinned: false,
  };
  let unpinned = 0;
  state.versions = [version, ...state.versions].filter((v) => v.pinned || ++unpinned <= HISTORY_MAX);
  persist();
  emit('library');
}

/**
 * Поставить новый текущий мозг (с его формой). Нынешний — сначала в историю.
 * @param {object} brain
 * @param {{ by: string, config?: object, generation?: number, handEdited?: boolean, note?: string }} how
 */
export function setBrain(brain, { config = state.config, by, generation = 0, handEdited = false, note }) {
  remember();
  const next = structuredClone(config);
  if (!sameSizes(next, state.config)) resetProgress();
  state.config = next;
  persist();
  emit('config');
  setChampion(brain, { by, generation, handEdited, note });
  emit('library');
}

/** Новая форма обнулит мозг? (другое число входов или слоёв при обученном мозге) */
export const shapeResetsBrain = (config) => !!state.champion && !sameSizes(config, state.config);

/** Поменять форму сети. Если мозг под неё не подходит — он уходит в историю, а учиться начнём с нуля. */
export function changeShape(config) {
  if (shapeResetsBrain(config)) {
    remember();
    resetProgress();
  }
  state.config = structuredClone(config);
  persist();
  emit('config');
}

/** «Сбросить мозг»: начать с нуля (прежний останется в истории) */
export function resetBrain() {
  remember();
  resetProgress();
  emit('library');
  showBanner('Мозг начнётся с нуля. Прежний — в «Истории»');
}

export function restoreVersion(id) {
  const v = state.versions.find((x) => x.id === id);
  if (!v || checkBrain(v.brain, sizesOf(v.config))) return;
  setBrain(cloneBrain(v.brain), { config: v.config, by: 'restore', generation: v.generation, handEdited: v.handEdited, note: v.brainNote });
  showBanner(`Вернули: ${v.brainNote || 'мозг'}`);
}

function togglePin(id) {
  const v = state.versions.find((x) => x.id === id);
  if (v) v.pinned = !v.pinned;
  persist();
  emit('library');
}

function removeVersion(id) {
  state.versions = state.versions.filter((x) => x.id !== id);
  persist();
  emit('library');
}

// ── блок «Мозг»: одинаковый на «Я учу» и «Учится само» ──

const shapeOf = (config) => `${sizesOf(config).join('-')} · ${thinkVariant(config.think)?.title ?? config.think}`;
const when = (iso) => new Date(iso).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function renderLibrary() {
  const current = state.champion
    ? `<b>${esc(brainTitle())}</b><span class="meta">${esc(shapeOf(state.config))}</span>`
    : `<span class="meta">Мозга пока нет — начнём с нуля (${esc(shapeOf(state.config))}).</span>`;
  const items = state.versions.map((v) => `
    <li class="${v.pinned ? 'pinned' : ''}">
      <button class="pin" data-pin="${v.id}" aria-pressed="${v.pinned}" title="${v.pinned ? 'Открепить' : 'Закрепить навсегда'}" aria-label="${v.pinned ? 'Открепить' : 'Закрепить навсегда'}">${PIN_ICON}</button>
      <span class="lib-name"><b>${esc(v.brainNote || 'мозг')}</b><span class="meta">${esc(shapeOf(v.config))} · ${esc(when(v.at))}</span></span>
      <button class="btn small" data-restore="${v.id}">Вернуть</button>
      <button class="lib-del" data-del-version="${v.id}" aria-label="Удалить версию">×</button>
    </li>`).join('');
  for (const root of $$('[data-library]')) {
    const confirming = root.dataset.confirm === 'reset';
    root.innerHTML = `
      <h2>Мозг</h2>
      <p class="lib-current">${current}</p>
      ${confirming
        ? `<div class="pending"><p>Мозг начнётся с нуля: веса станут случайными. Нынешний останется в «Истории».</p>
            <div class="row"><button class="btn small danger" data-reset-yes>Сбросить</button><button class="btn small" data-reset-no>Отмена</button></div></div>`
        : `<div class="row"><button class="btn small" data-reset ${state.champion ? '' : 'disabled'}>Сбросить мозг</button></div>`}
      <details class="history" ${state.versions.length ? '' : 'hidden'} ${historyOpen ? 'open' : ''}>
        <summary>История · ${state.versions.length}</summary>
        <p class="hint">Перед каждым обучением, стартом роя, ручной правкой и сбросом мозг сохраняется сам. Звёздочка — закрепить версию навсегда, остальные хранятся ${HISTORY_MAX} последних.</p>
        <ol class="lib-list">${items}</ol>
      </details>`;
  }
}

delegate('body', 'click', '[data-reset]', (b) => {
  b.closest('[data-library]').dataset.confirm = 'reset';
  renderLibrary();
});
delegate('body', 'click', '[data-reset-no]', (b) => {
  delete b.closest('[data-library]').dataset.confirm;
  renderLibrary();
});
delegate('body', 'click', '[data-reset-yes]', (b) => {
  delete b.closest('[data-library]').dataset.confirm;
  resetBrain();
});
delegate('body', 'click', '.history > summary', () => (historyOpen = !historyOpen));
delegate('body', 'click', '[data-restore]', (b) => restoreVersion(b.dataset.restore));
delegate('body', 'click', '[data-pin]', (b) => togglePin(b.dataset.pin));
delegate('body', 'click', '[data-del-version]', (b) => removeVersion(b.dataset.delVersion));

on('library', renderLibrary);
on('champion', renderLibrary);
on('config', renderLibrary);
