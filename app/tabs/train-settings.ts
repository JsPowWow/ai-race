// Настройки «Учится само»: трасса, рецепт роя, скорость, камера. Общие для всех машин гаража —
// лежат в state.train и сохраняются в localStorage (app/state.ts).
import { signal } from '@reely/dommy';
import { state, persist, type TrainSettings, type Speed, type Camera } from '../state.ts';

export type { TrainSettings, Speed, Camera };

const stored = (): TrainSettings => state.train;

const current = signal<TrainSettings>(stored());

/** Настройки сейчас. Читать вызовом, как сигнал: train().speed */
export const train = (): TrainSettings => current.value;

/** Поменять одну настройку и сохранить. Объект каждый раз новый — так сигнал знает, что пора обновить страницу */
export function setTrain<K extends keyof TrainSettings>(key: K, value: TrainSettings[K]): void {
  state.train = { ...stored(), [key]: value };
  current.value = stored();
  persist();
}
