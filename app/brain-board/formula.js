// Формула нейрона «в столбик»: те же округлённые числа, что в узлах, поэтому сумма у новичка сходится.
import { esc } from '../ui.js';

/** Числа без дребезга: знак всегда, две цифры, ширина одна и та же */
export const fmt = (v) => (v < 0 ? '−' : '+') + Math.min(0.99, Math.abs(v)).toFixed(2).replace(/^0/, '');
/** Веса бывают больше 1 — у них целая цифра видна всегда: «+1.73», «−0.40» */
export const fmtW = (v) => (v < 0 ? '−' : '+') + Math.min(9.99, Math.abs(v)).toFixed(2);
/** Проценты кнопок пульта, выровненные по правому краю: «  7%», « 72%» */
export const pct = (v) => `${String(Math.round(Math.max(0, Math.min(1, v)) * 100)).padStart(3, ' ')}%`;
const round2 = (v) => Math.round(v * 100) / 100;
const weak = (n) => (n % 10 === 1 && n % 100 !== 11 ? 'слабый' : 'слабых');

/**
 * @param {{ layers: { weights: number[][], biases: number[] }[] }} brain
 * @param {number[][]} trace значения всех слоёв на этом тике
 * @param {number} k слой нейрона (1 — первый скрытый)
 * @param {number} i номер нейрона в слое
 * @param {{ inputNames: string[], outNames: string[], act: typeof SMOOTH }} names
 */
export function formulaHTML(brain, trace, k, i, { inputNames, outNames, act }) {
  const L = brain.layers[k - 1];
  const source = (n) => (k === 1 ? inputNames[n] : `н${n + 1}`);
  const terms = trace[k - 1]
    .map((a, n) => ({ n, a: round2(a), w: round2(L.weights[n][i]) }))
    .map((t) => ({ ...t, p: round2(t.a * t.w) }))
    .sort((x, y) => Math.abs(y.p) - Math.abs(x.p));
  const visible = terms.filter((t) => Math.abs(t.p) >= 0.01);
  const top = visible.slice(0, 4);
  const rest = visible.length - top.length;
  const sum = round2(terms.reduce((s, t) => s + t.p, 0));
  const bias = round2(L.biases[i]);
  const z = round2(sum - bias);
  const isOut = k === brain.layers.length;
  const value = isOut ? act.out(z) : act.hidden(z);
  const rows = top.map((t) => `<span><span class="src">${esc(source(t.n).padEnd(3, ' '))}</span> ${fmt(t.a)} × ${fmtW(t.w)} = ${fmtW(t.p)}</span>`).join('');
  const more = rest > 0 ? `<span class="more">и ещё ${rest} ${weak(rest)}</span>` : '';
  return `<b>${isOut ? `Кнопка «${esc(outNames[i])}»` : `Нейрон ${i + 1}`}</b>${rows}${more}
    <span class="sep">сумма ${fmtW(sum)} − порог ${bias < 0 ? `(${fmtW(bias)})` : fmtW(bias)} = <em>${fmtW(z)}</em></span>
    <span>${(isOut ? act.outText : act.hiddenText)(fmtW(z))} = <em>${isOut ? pct(value).trim() : fmt(value)}</em></span>`;
}

/** Вариант «плавный»: внутри tanh(2z), на выходе σ(3z) — как в student/think.js */
export const SMOOTH = {
  hidden: (z) => Math.tanh(2 * z), hiddenText: (z) => `tanh(2 × ${z})`,
  out: (z) => 1 / (1 + Math.exp(-3 * z)), outText: (z) => `σ(3 × ${z})`,
};
