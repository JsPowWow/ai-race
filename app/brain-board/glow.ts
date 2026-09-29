// «Жизнь» табло во времени: что сейчас горит и насколько, какие импульсы бегут, какие числа подписаны у узлов.
// Всё хранится в плоских массивах одной формы с мозгом и переиспользуется каждый кадр: кадр не создаёт мусора.
// Без DOM — только числа; рисует их fire-skin.ts.
import { BUTTONS } from '../../engine/brain.ts';
import type { Brain } from '../../engine/brain.ts';
import { fmt, pct } from './formula.ts';

const ATTACK = 0.04, DECAY = 0.3; // секунды: вспыхивает быстро, гаснет чуть медленнее
const SMOOTHING = 0.12; // секунды: числа у узлов догоняют настоящие плавно, без дребезга
const READOUT_MS = 100; // подписи у узлов меняются 10 раз в секунду — чаще глаз не успевает прочитать
const MAX_PULSES = 90;

/** Импульс бежит по связи слоя k от нейрона i к нейрону j; t — сколько пробежал (0…1), v — сила сигнала */
export type Pulse = { k: number; i: number; j: number; t: number; v: number };

/** Значения всех слоёв на этом тике: trace[0] — входы, дальше слои (как feedForward.lastTrace) */
export type Trace = readonly (readonly number[])[];

export type Glow = {
  /** нейронов в каждом слое */
  sizes: readonly number[];
  /** signal[k][i * sizes[k + 1] + j] — сигнал по связи i → j: вход × вес, нормированный на самый сильный в слое (−1…1) */
  signal: Float32Array[];
  /** «теплота» связей (там же, где signal) и нейронов: nodeHeat[k][i] */
  edgeHeat: Float32Array[];
  nodeHeat: Float32Array[];
  /** сглаженные значения и подписи к ним: «+.42» у нейрона, «72%» у кнопки */
  shown: Float32Array[];
  readout: string[][];
  readoutAt: number;
  fresh: boolean;
  pulses: Pulse[];
};

/** Пустое табло для мозга такой формы: всё «холодное» */
export function createGlow(sizes: readonly number[]): Glow {
  const perLayer = (count: (k: number) => number, layers: number) => Array.from({ length: layers }, (_, k) => new Float32Array(count(k)));
  const edges = () => perLayer((k) => sizes[k] * sizes[k + 1], sizes.length - 1);
  const nodes = () => perLayer((k) => sizes[k], sizes.length);
  return {
    sizes, signal: edges(), edgeHeat: edges(), nodeHeat: nodes(), shown: nodes(),
    readout: sizes.map((size) => Array.from({ length: size }, () => '')), readoutAt: -Infinity, fresh: true, pulses: [],
  };
}

/**
 * Прожить dt секунд: пересчитать сигналы, «теплоту», импульсы и подписи.
 * @param now время в мс (performance.now) — когда обновлять подписи
 * @param motion можно ли запускать импульсы (нельзя, если человек просит поменьше движения)
 * @param rnd откуда брать случайность для импульсов (тестам — своя)
 */
export function stepGlow(glow: Glow, brain: Brain, trace: Trace, dt: number, now: number, motion: boolean, rnd: () => number = Math.random): void {
  const { sizes } = glow;
  const up = 1 - Math.exp(-dt / ATTACK), down = 1 - Math.exp(-dt / DECAY);
  /** К цели быстро вверх, медленно вниз */
  const warm = (h: number, target: number) => h + (target - h) * (target > h ? up : down);

  brain.layers.forEach((layer, k) => {
    const signal = glow.signal[k], heat = glow.edgeHeat[k], cols = sizes[k + 1];
    let max = 1e-6;
    for (let i = 0; i < sizes[k]; i++) {
      const row = layer.weights[i], a = trace[k][i];
      for (let j = 0; j < cols; j++) {
        const v = a * row[j];
        signal[i * cols + j] = v;
        max = Math.max(max, Math.abs(v));
      }
    }
    for (let e = 0; e < signal.length; e++) {
      signal[e] /= max;
      heat[e] = warm(heat[e], Math.abs(signal[e]) ** 1.4);
    }
  });

  const last = sizes.length - 1;
  glow.nodeHeat.forEach((heat, k) => {
    for (let i = 0; i < heat.length; i++) {
      const a = trace[k][i];
      // кнопки и заметки горят силой нажатия (0…1), нейроны и входы — модулем: −1 горит так же ярко, как +1
      heat[i] = warm(heat[i], k === last ? a : Math.min(1, Math.abs(a)));
    }
  });

  movePulses(glow, dt, motion, rnd);
  smoothNumbers(glow, trace, dt, now);
}

/** Сколько импульсов в секунду рождает связь с самым сильным сигналом (слабее — реже) */
const PULSES_PER_SECOND = 0.72;

/**
 * Импульсы бегут по сильным связям: чем сильнее сигнал, тем чаще. Рождаются по времени, а не по кадрам:
 * на экране 120 Гц их не вдвое больше, а на паузе (dt = 0) — ни одного нового, и бегущие стоят
 */
function movePulses(glow: Glow, dt: number, motion: boolean, rnd: () => number): void {
  const list = glow.pulses;
  if (motion && dt > 0) {
    glow.signal.forEach((signal, k) => {
      const cols = glow.sizes[k + 1];
      for (let e = 0; e < signal.length && list.length < MAX_PULSES; e++) {
        const v = signal[e];
        if (Math.abs(v) > 0.5 && rnd() < Math.abs(v) * PULSES_PER_SECOND * dt) list.push({ k, i: Math.floor(e / cols), j: e % cols, t: 0, v });
      }
    });
  }
  let kept = 0; // добежавшие убираем, сдвигая оставшиеся к началу: без splice и новых массивов
  for (const p of list) {
    p.t += dt * 1.5;
    if (p.t < 1) list[kept++] = p;
  }
  list.length = kept;
}

/** Числа без дребезга: значения догоняют плавно, а подписи обновляются 10 раз в секунду */
function smoothNumbers(glow: Glow, trace: Trace, dt: number, now: number): void {
  const a = glow.fresh ? 1 : 1 - Math.exp(-dt / SMOOTHING);
  glow.fresh = false;
  glow.shown.forEach((shown, k) => {
    for (let i = 0; i < shown.length; i++) shown[i] += (trace[k][i] - shown[i]) * a;
  });
  if (now - glow.readoutAt < READOUT_MS) return;
  glow.readoutAt = now;
  const last = glow.sizes.length - 1;
  glow.shown.forEach((shown, k) => {
    for (let i = 0; i < shown.length; i++) glow.readout[k][i] = k === last && i < BUTTONS.length ? pct(shown[i]) : fmt(shown[i]);
  });
}
