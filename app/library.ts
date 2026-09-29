// Мозг и его история. Блок «Мозг» с «Историей» на странице — app/library-view.tsx.
//
// Текущий мозг (state.champion + state.config) — один на весь сайт: его учат на «Я учу» и «Учится само»,
// он сдаёт экзамен и едет на гонку. Мозг всегда хранится вместе со своей формой: сенсоры, слои, вариант.
//
// Учиться — значит продолжать с текущего мозга. Перед каждым большим изменением
// (обучение на заездах, старт роя, ручная правка, сброс, другая форма сети) текущий мозг
// сам попадает в «Историю» — к любой версии можно вернуться. звёздочка закрепляет версию навсегда,
// незакреплённых хранится HISTORY_MAX последних.
import { cloneBrain, checkBrain, type Brain } from '../engine/brain.ts';
import { state, type Shape, type Version, persist, sizesOf, sameSizes, setChampion, resetProgress, emit, brainTitle } from './state.ts';
import { showBanner } from './stage.ts';

/** Незакреплённых версий в «Истории» храним столько последних */
export const HISTORY_MAX = 10;

const sameBrain = (a: Brain, b: Brain): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Сохранить текущий мозг в историю (если он есть и ещё не лежит там последним) */
export function remember(): void {
  if (!state.champion) return;
  const [latest] = state.versions;
  if (latest && sameBrain(latest.brain, state.champion) && sameSizes(latest.config, state.config)) return;
  const version: Version = {
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

/** Поставить новый текущий мозг (с его формой). Нынешний — сначала в историю. by, generation… — кто и как его получил */
export function setBrain(brain: Brain, { config = state.config, by, generation = 0, handEdited = false, note }: { by: string; config?: Shape; generation?: number; handEdited?: boolean; note?: string }): void {
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
export const shapeResetsBrain = (config: Shape): boolean => !!state.champion && !sameSizes(config, state.config);

/** Поменять форму сети. Если мозг под неё не подходит — он уходит в историю, а учиться начнём с нуля. */
export function changeShape(config: Shape): void {
  if (shapeResetsBrain(config)) {
    remember();
    resetProgress();
  }
  state.config = structuredClone(config);
  persist();
  emit('config');
}

/** «Сбросить мозг»: начать с нуля (прежний останется в истории) */
export function resetBrain(): void {
  remember();
  resetProgress();
  emit('library');
  showBanner('Мозг начнётся с нуля. Прежний — в «Истории»');
}

export function restoreVersion(id: string): void {
  const v = state.versions.find((x) => x.id === id);
  if (!v || checkBrain(v.brain, sizesOf(v.config))) return;
  setBrain(cloneBrain(v.brain), { config: v.config, by: 'restore', generation: v.generation, handEdited: v.handEdited, note: v.brainNote });
  showBanner(`Вернули: ${v.brainNote || 'мозг'}`);
}

export function togglePin(id: string): void {
  const v = state.versions.find((x) => x.id === id);
  if (v) v.pinned = !v.pinned;
  persist();
  emit('library');
}

export function removeVersion(id: string): void {
  state.versions = state.versions.filter((x) => x.id !== id);
  persist();
  emit('library');
}
