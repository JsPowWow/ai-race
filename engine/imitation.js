// Обучение с учителем («повторяй за мной»): сеть учится нажимать то же, что нажимал человек.
//
// Пример — это пара: что видела сеть на входе (x) и что нажал учитель (y = [газ, тормоз, влево, вправо]).
// Заметки (m1…m3) учитель не пишет: на входе они нулевые, а ошибку считаем только по 4 кнопкам.
// Поэтому веса заметок обучение на примерах не трогает — пользоваться ими мозг учится только в рое.
// Обучение — обратное распространение ошибки: для каждого примера смотрим, насколько ответ сети
// отличается от ответа учителя, и чуть-чуть подвигаем каждый вес в сторону, где ошибка меньше.
//
// Активации те же, что у варианта мозга «Плавный»: внутри tanh(2·z), на выходе sigmoid(3·z), z = сумма − порог.
// Поэтому обученный мозг сразу ездит с think = 'smooth'.
import { NOTES } from './brain.js';

export const TEACH_THINK = 'smooth';

/** Снимок одного тика (после car.step): что видела сеть на входе и что нажал водитель */
export function sampleOf(car) {
  const c = car.controls;
  return {
    x: car.lastInputs ?? car.inputs(),
    y: [c.gas, c.brake, c.left, c.right].map((v) => (v > 0.5 ? 1 : 0)),
  };
}

/**
 * Стоит ли учиться на этом примере. Машина стоит, а водитель ничего не жмёт — это он ещё
 * не тронулся после рестарта. Таких тиков набирается много, а «газ с места» — всего один-два,
 * и ученик выучит главное: «стоишь — стой». Поэтому такие примеры выбрасываем.
 */
export const worthLearning = ({ x, y }, sensorCount = (x.length - 1 - NOTES) / 2) => y.some(Boolean) || Math.abs(x[sensorCount]) > 0.02;

const sigmoid = (z) => 1 / (1 + Math.exp(-z));

/** Прямой проход с запоминанием всех слоёв — они нужны, чтобы посчитать поправки */
function forward(brain, x) {
  const acts = [x];
  const last = brain.layers.length - 1;
  brain.layers.forEach((layer, k) => {
    const prev = acts[k];
    acts.push(layer.biases.map((bias, j) => {
      let z = -bias;
      for (let i = 0; i < prev.length; i++) z += prev[i] * layer.weights[i][j];
      return k === last ? sigmoid(3 * z) : Math.tanh(2 * z);
    }));
  });
  return acts;
}

/** Ответ сети на входы x — 4 числа от 0 до 1 */
export const predict = (brain, x) => forward(brain, x).at(-1);

/** Один проход по всем примерам (эпоха). Меняет brain на месте. Возвращает среднюю ошибку. */
export function trainEpoch(brain, samples, learningRate = 0.1, rnd = Math.random) {
  const order = samples.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  let loss = 0;
  const last = brain.layers.length - 1;
  for (const index of order) {
    const { x, y } = samples[index];
    const acts = forward(brain, x);
    // ошибка на выходе и её «вина» по слоям, от выхода к входу
    // учитель знает только кнопки: у заметок ошибки нет, и их веса не двигаются
    let delta = acts.at(-1).map((a, j) => {
      if (j >= y.length) return 0;
      loss += (a - y[j]) ** 2;
      return (a - y[j]) * 3 * a * (1 - a);
    });
    for (let k = last; k >= 0; k--) {
      const layer = brain.layers[k];
      const input = acts[k];
      const prevDelta = k > 0
        ? input.map((a, i) => layer.weights[i].reduce((sum, w, j) => sum + w * delta[j], 0) * 2 * (1 - a * a))
        : null;
      for (let j = 0; j < delta.length; j++) {
        const step = learningRate * delta[j];
        for (let i = 0; i < input.length; i++) layer.weights[i][j] -= step * input[i];
        layer.biases[j] += step;
      }
      delta = prevDelta;
    }
  }
  return loss / (samples.length * (samples[0]?.y.length ?? 4));
}

/** Насколько сеть совпадает с учителем: доля примеров, где все 4 кнопки такие же */
export function agreement(brain, samples) {
  if (!samples.length) return 0;
  let same = 0;
  for (const { x, y } of samples) {
    const out = predict(brain, x).slice(0, y.length);
    if (out.every((v, j) => (v > 0.5 ? 1 : 0) === y[j])) same++;
  }
  return same / samples.length;
}

// ── компактное хранение примеров ──
// Пример → строка: первый символ — какие кнопки нажаты (4 бита), дальше по символу на каждый вход.
// Входы лежат в диапазоне −1…1 и хранятся с шагом 0,01. 8000 примеров × 6 входов ≈ 160 КБ вместо ~770 КБ.

const BASE = 0x100; // символы от U+0100: их не нужно экранировать в JSON
const STEPS = 100;

export function packSample({ x, y }) {
  const buttons = y.reduce((bits, v, i) => bits | ((v ? 1 : 0) << i), 0);
  const inputs = x.map((v) => String.fromCharCode(BASE + Math.round((Math.max(-1, Math.min(1, v)) + 1) * STEPS)));
  return String.fromCharCode(BASE + buttons) + inputs.join('');
}

export function unpackSample(text) {
  const buttons = text.charCodeAt(0) - BASE;
  return {
    x: [...text.slice(1)].map((c) => (c.charCodeAt(0) - BASE) / STEPS - 1),
    y: [0, 1, 2, 3].map((i) => (buttons >> i) & 1),
  };
}
