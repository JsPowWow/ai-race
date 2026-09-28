// Настройки «Учится само»: трасса, рецепт роя, скорость, камера. Общие для всех машин гаража —
// лежат в state.train и сохраняются в localStorage (app/state.js).
import { signal } from '@reely/dommy';
import type { TrafficLevel } from '../../engine/traffic.ts';
import { state, persist } from '../state.js';

export type Speed = '1' | '4' | '16' | 'turbo';
export type Camera = 'fit' | 'follow';

export type TrainSettings = {
  /** учебная трасса, 'seed' — по seed, 'mix' — каждое поколение новая */
  trackId: string;
  seed: string;
  /** машины на трассе: без машин, попутные, попутные и встречные */
  traffic: TrafficLevel;
  parents: 1 | 2;
  /** галочки фитнеса (FITNESS_PARTS) */
  parts: string[];
  /** «Мой вариант»: фитнес из student/fitness.js вместо галочек */
  ownFitness: boolean;
  mutation: string;
  population: number;
  rate: number;
  speed: Speed;
  camera: Camera;
};

/** state.train с типом: state.js пока на JS, и там это «что угодно из localStorage» */
const stored = (): TrainSettings => state.train as TrainSettings;

const current = signal<TrainSettings>(stored());

/** Настройки сейчас. Читать вызовом, как сигнал: train().speed */
export const train = (): TrainSettings => current.value;

/** Поменять одну настройку и сохранить. Объект каждый раз новый — так сигнал знает, что пора обновить страницу */
export function setTrain<K extends keyof TrainSettings>(key: K, value: TrainSettings[K]): void {
  state.train = { ...stored(), [key]: value };
  current.value = stored();
  persist();
}
