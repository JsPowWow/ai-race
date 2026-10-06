// Формула нейрона «в столбик»: из каких слагаемых сложилась сумма и что нейрон из неё сделал.
// Слагаемые округлены так же, как числа в узлах, и складываются ровно в сумму — у новичка всё сходится.
// Здесь только числа и строки, без DOM: карточку рисует formula-card.tsx.
import { BUTTONS } from '../../engine/net/brain.ts';
import type { Brain } from '../../engine/net/brain.ts';

/** Как подписать активацию нейрона: имя для рамки слоя и формула с числом */
export type Act = {
  hiddenName: string; hiddenText: (z: string) => string;
  outName: string; outText: (z: string) => string;
};

/** «Плавный»: внутри tanh(2z), на выходе σ(3z) — как в student/think.js */
export const SMOOTH: Act = {
  hiddenName: 'tanh(2z)', hiddenText: (z) => `tanh(2 × ${z})`,
  outName: 'σ(3z)', outText: (z) => `σ(3 × ${z})`,
};
/** Любой другой вариант (ступенька, свой): формулу не знаем — пишем f(z), а значение берём настоящее */
export const ANY_ACT: Act = {
  hiddenName: '', hiddenText: (z) => `f(${z})`,
  outName: '', outText: (z) => `f(${z})`,
};

/** Числа без дребезга: знак всегда, две цифры, ширина одна и та же: «+.42», «−.07» */
export const fmt = (v: number): string => (v < 0 ? '−' : '+') + Math.min(0.99, Math.abs(v)).toFixed(2).replace(/^0/, '');
/** Веса бывают больше 1 — у них целая цифра видна всегда: «+1.73», «−0.40» */
export const fmtW = (v: number): string => (v < 0 ? '−' : '+') + Math.min(9.99, Math.abs(v)).toFixed(2);
/** Сила нажатия кнопки пульта в процентах: «7%», «72%» */
export const pct = (v: number): string => `${Math.round(Math.max(0, Math.min(1, v)) * 100)}%`;

/** Значение в формуле — как в узле, только единица честно пишется «+1.0»: иначе «+.99 × +0.50 = +0.50» не сходится */
const fmtA = (v: number): string => (Math.abs(v) >= 0.995 ? `${v < 0 ? '−' : '+'}1.0` : fmt(v));
const round2 = (v: number) => Math.round(v * 100) / 100;
const weaker = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'слабый' : 'слабых');

/** Сколько самых сильных слагаемых показать строками: остальные — одной строкой «и ещё …» */
export const TOP_TERMS = 4;

/** Карточка формулы — готовые строки */
export type Formula = {
  title: string;
  /** самые сильные слагаемые: откуда (s1, н3) и «вход × вес = вклад» */
  terms: { source: string; math: string }[];
  /** «и ещё 5 слабых = −0.36» или '' */
  rest: string;
  /** «сумма +0.12 − порог +0.07 =» и то, что получилось (z) */
  sum: string; z: string;
  /** «tanh(2 × +0.05) =» и что нейрон сказал */
  activation: string; value: string;
};

/** Как назвать входы и выходы и как подписать активацию */
export type FormulaNames = { inputNames: readonly string[]; outNames: readonly string[]; act: Act };

/**
 * Формула нейрона i слоя k (1 — первый скрытый) на этом тике.
 * @param trace значения всех слоёв на этом тике
 */
export function neuronFormula(brain: Brain, trace: readonly (readonly number[])[], k: number, i: number, { inputNames, outNames, act }: FormulaNames): Formula {
  const L = brain.layers[k - 1];
  const source = (n: number) => (k === 1 ? inputNames[n] : `н${n + 1}`);
  const terms = trace[k - 1]
    .map((a, n) => {
      const ar = round2(a), w = round2(L.weights[n][i]);
      return { n, a: ar, w, p: round2(ar * w) };
    })
    .filter((t) => t.p !== 0) // вклад меньше 0.01 не виден и в сумму не идёт
    .sort((x, y) => Math.abs(y.p) - Math.abs(x.p));
  const top = terms.slice(0, TOP_TERMS), rest = terms.slice(TOP_TERMS);
  const total = (list: typeof terms) => round2(list.reduce((s, t) => s + t.p, 0));
  const sum = total(terms);
  const bias = round2(L.biases[i]);
  const z = round2(sum - bias);
  const isOut = k === brain.layers.length;
  const value = trace[k][i]; // что нейрон сказал на самом деле — верно для любого варианта «думания»
  return {
    title: !isOut ? `Нейрон ${i + 1}` : i < BUTTONS.length ? `Кнопка «${outNames[i]}»` : `Заметка ${outNames[i]}`,
    terms: top.map((t) => ({ source: source(t.n), math: `${fmtA(t.a)} × ${fmtW(t.w)} = ${fmtW(t.p)}` })),
    rest: rest.length ? `и ещё ${rest.length} ${weaker(rest.length)} = ${fmtW(total(rest))}` : '',
    sum: `сумма ${fmtW(sum)} − порог ${bias < 0 ? `(${fmtW(bias)})` : fmtW(bias)} =`, z: fmtW(z),
    activation: `${(isOut ? act.outText : act.hiddenText)(fmtW(z))} =`, value: isOut ? pct(value) : fmtA(value),
  };
}
