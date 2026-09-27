// Мозги: текущий, прежний («↶ Вернуть») и библиотека сохранённых.
//
// Текущий мозг (state.champion + state.config) — тот, что едет на «Я учу», доучивается роем,
// сдаёт экзамен и уходит на гонку. Мозг всегда хранится вместе со своей формой: лучи, слои, вариант.
// Поэтому, взяв из библиотеки мозг с 7 лучами, получаешь и машину с 7 лучами.
//
// Когда текущий мозг заменяют целиком (обучили новый, взяли из библиотеки, поменяли форму сети),
// старый не пропадает: он становится «прежним», и его можно вернуть одной кнопкой.
// В библиотеку мозг попадает только по кнопке «Сохранить».
import { cloneBrain, checkBrain } from '../engine/brain.js';
import { state, persist, sizesOf, sameSizes, setChampion, resetProgress, emit, on, thinkVariant } from './state.js';
import { showBanner } from './stage.js';
import { $$, esc, delegate } from './ui.js';

const LIBRARY_MAX = 30;

const snapshot = () => (state.champion
  ? {
    brain: cloneBrain(state.champion),
    config: structuredClone(state.config),
    generation: state.generation,
    handEdited: state.handEdited,
    brainNote: state.brainNote,
  }
  : null);

/** Отложить текущий мозг в «прежний» (если он есть) */
export function stashCurrent() {
  const current = snapshot();
  if (!current) return;
  state.previous = current;
  persist();
  emit('library');
}

/**
 * Поставить новый текущий мозг. config — его форма (по умолчанию текущая).
 * Старый уходит в «прежний». Если форма сети другая — обучение роя начинается заново.
 */
export function setBrain(brain, { config = state.config, by, generation = 0, handEdited = false, note } = {}) {
  stashCurrent();
  const next = structuredClone(config);
  if (!sameSizes(next, state.config)) resetProgress();
  state.config = next;
  persist();
  emit('config');
  setChampion(brain, { by, generation, handEdited, note });
  emit('library');
}

/** Поменять форму сети (лучи, слои). Обученный мозг под новую форму не подходит — откладываем его. */
export function changeShape(config) {
  const resized = !sameSizes(config, state.config);
  if (resized && state.champion) {
    stashCurrent();
    resetProgress();
    showBanner(`Сеть стала ${sizesOf(config).join('-')}. Прежний мозг отложен — его можно вернуть в блоке «Мозг».`, 3200);
  }
  state.config = structuredClone(config);
  persist();
  emit('config');
}

export function restorePrevious() {
  const prev = state.previous;
  if (!prev) return;
  // setBrain отложит нынешний мозг в «прежний» — так можно вернуться и обратно
  setBrain(prev.brain, { config: prev.config, by: 'restore', generation: prev.generation, handEdited: prev.handEdited, note: prev.brainNote });
  showBanner('Вернули прежний мозг');
}

export function saveToLibrary(name) {
  if (!state.champion) return showBanner('Пока нечего сохранять: сначала обучи мозг');
  const entry = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    name: (name || '').trim().slice(0, 40) || suggestName(),
    savedAt: new Date().toISOString(),
    ...snapshot(),
  };
  state.library = [entry, ...state.library].slice(0, LIBRARY_MAX);
  state.libraryId = entry.id;
  persist();
  emit('library');
  showBanner(`Сохранено: «${entry.name}»`);
}

export function useFromLibrary(id) {
  const entry = state.library.find((e) => e.id === id);
  if (!entry) return;
  if (checkBrain(entry.brain, sizesOf(entry.config))) return showBanner('Этот мозг повреждён');
  setBrain(cloneBrain(entry.brain), { config: entry.config, by: 'library', generation: entry.generation, handEdited: entry.handEdited, note: entry.brainNote });
  state.libraryId = entry.id;
  persist();
  emit('library');
  showBanner(`Текущий мозг: «${entry.name}»`);
}

export function removeFromLibrary(id) {
  state.library = state.library.filter((e) => e.id !== id);
  if (state.libraryId === id) state.libraryId = null;
  persist();
  emit('library');
}

const suggestName = () => `Мозг ${state.library.length + 1}${state.brainNote ? ` · ${state.brainNote}` : ''}`;

// ── блок «Мозг»: один и тот же на «Я учу» и «Учится само» ──

const shapeOf = (config) => `${sizesOf(config).join('-')} · ${thinkVariant(config.think)?.title ?? config.think}`;
const when = (iso) => new Date(iso).toLocaleString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export function renderLibrary() {
  const current = state.champion
    ? `<b>${esc(state.brainNote || 'мозг')}</b><span class="meta">${esc(shapeOf(state.config))}${state.libraryId ? ' · сохранён' : ' · не сохранён'}</span>`
    : '<span class="meta">Мозга пока нет: запиши заезды и обучи его — или поправь веса руками.</span>';
  const prev = state.previous
    ? `<button class="btn small" data-lib-undo title="${esc(state.previous.brainNote || '')}">↶ Вернуть прежний</button>` : '';
  const items = state.library.map((e) => `
    <li class="${e.id === state.libraryId ? 'active' : ''}">
      <span class="lib-name"><b>${esc(e.name)}</b><span class="meta">${esc(shapeOf(e.config))} · ${esc(when(e.savedAt))}</span></span>
      <button class="btn small" data-lib-use="${e.id}" ${e.id === state.libraryId ? 'disabled' : ''}>${e.id === state.libraryId ? 'Текущий' : 'Взять'}</button>
      <button class="lib-del" data-lib-del="${e.id}" aria-label="Удалить «${esc(e.name)}»">×</button>
    </li>`).join('');
  for (const root of $$('[data-library]')) {
    root.innerHTML = `
      <h2>Мозг</h2>
      <p class="lib-current">${current}</p>
      <div class="row lib-save">
        <input type="text" data-lib-name maxlength="40" placeholder="Название" aria-label="Название мозга" ${state.champion ? '' : 'disabled'}>
        <button class="btn small primary" data-lib-save ${state.champion ? '' : 'disabled'}>Сохранить</button>
        ${prev}
      </div>
      ${items ? `<ol class="lib-list">${items}</ol>` : '<p class="hint">Библиотека пуста. Понравился мозг — сохрани его: потом можно вернуться к нему или сравнить на «Экзамене».</p>'}`;
  }
}

delegate('body', 'click', '[data-lib-save]', (b) => {
  saveToLibrary(b.closest('[data-library]').querySelector('[data-lib-name]').value);
});
delegate('body', 'click', '[data-lib-use]', (b) => useFromLibrary(b.dataset.libUse));
delegate('body', 'click', '[data-lib-del]', (b) => removeFromLibrary(b.dataset.libDel));
delegate('body', 'click', '[data-lib-undo]', restorePrevious);

on('library', renderLibrary);
on('champion', renderLibrary);
