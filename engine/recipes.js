// Рецепты роя: за что хвалить машину (фитнес по частям) и как делать детей (мутация, кроссовер).
// Выбираются на вкладке «Учится само». Каждый вариант проверен опытом: tools/swarm-check.mjs.
// Случайность здесь — только при рождении детей, не на пути заезда: заезд по-прежнему детерминирован.
import { randomGauss } from './utils.js';

/** @typedef {{ progress: number, finished: boolean, crashed: boolean, ticks: number, wiggle: number }} Report отчёт о заезде (carReport) */

/**
 * Фитнес по частям: основа — всегда расстояние, каждая галочка добавляет одну мысль.
 * Порядок важен: сначала «половина разбившимся», потом бонус и штраф.
 * @type {Record<string, { title: string, hint: string, apply: (score: number, car: Report) => number }>}
 */
export const FITNESS_PARTS = {
  careful: {
    title: 'Половина очков разбившимся',
    hint: 'Рой учится не биться: реже врезается во встречных. В опыте с этой галочкой рой застревает реже всего.',
    apply: (score, car) => (car.crashed ? score / 2 : score),
  },
  finish: {
    title: 'Бонус за финиш и время',
    hint: 'Доехавшим — бонус, и чем быстрее, тем больше. Без него рою всё равно, как долго ехать: все доехавшие равны.',
    // на три круга дают меньше 20 тыс. тиков, так что бонус всегда больше нуля и больше любого «почти»
    apply: (score, car) => (car.finished ? score + 20000 - car.ticks : score),
  },
  smooth: {
    title: 'Штраф за виляние',
    hint: 'Кто дёргает руль, теряет очки. Рулит плавнее, но едет медленнее.',
    apply: (score, car) => score - car.wiggle * 5,
  },
};

export const DEFAULT_PARTS = ['careful', 'finish'];

/**
 * Фитнес из выбранных частей: расстояние, а к нему — поправки в порядке FITNESS_PARTS.
 * @param {string[]} parts
 * @returns {(car: Report) => number}
 */
export function fitnessOf(parts) {
  const chosen = Object.entries(FITNESS_PARTS).filter(([id]) => parts.includes(id)).map(([, part]) => part.apply);
  return (car) => chosen.reduce((score, apply) => apply(score, car), car.progress);
}

/** @typedef {{ layers: { weights: number[][], biases: number[] }[] }} Brain */

/** Пройтись по всем числам мозга: каждое заменить на change(число) */
function eachNumber(brain, change) {
  for (const layer of brain.layers) {
    layer.biases = layer.biases.map(change);
    layer.weights = layer.weights.map((row) => row.map(change));
  }
}

/** @type {Record<string, { title: string, hint: string, mutate: (brain: Brain, rate: number) => void }>} */
export const MUTATIONS = {
  spot: {
    title: 'Точечная',
    hint: 'Каждое число с шансом «сила мутации» чуть сдвигаем, остальные не трогаем. Ребёнок похож на родителя, но где-то пробует новое.',
    mutate: (brain, rate) => eachNumber(brain, (w) => (Math.random() < rate ? w + randomGauss() * 0.4 : w)),
  },
  bold: {
    title: 'Смелая',
    hint: 'Так же точечно, но сдвиги большие. Помогает, когда рой застрял: дети сильнее отличаются от родителя.',
    mutate: (brain, rate) => eachNumber(brain, (w) => (Math.random() < rate ? w + randomGauss() * 1 : w)),
  },
  noise: {
    title: 'Лёгкий шум',
    hint: 'Все числа сразу чуть-чуть встряхиваем, сила — «сила мутации». Движется плавно, но медленно.',
    mutate: (brain, rate) => eachNumber(brain, (w) => w + randomGauss() * rate),
  },
};

/**
 * Ребёнок от двух родителей — целыми нейронами: монетка на каждый нейрон решает,
 * чьи все его входящие связи и порог он получит. Нейрон — цельная «идея» («справа близко — рули влево»), её не рвём.
 * @param {Brain} mom
 * @param {Brain} dad
 * @returns {Brain}
 */
export function crossover(mom, dad) {
  return {
    layers: mom.layers.map((layer, k) => {
      const fromMom = layer.biases.map(() => Math.random() < 0.5);
      const other = dad.layers[k];
      return {
        weights: layer.weights.map((row, i) => row.map((w, j) => (fromMom[j] ? w : other.weights[i][j]))),
        biases: layer.biases.map((b, j) => (fromMom[j] ? b : other.biases[j])),
      };
    }),
  };
}

export const DEFAULT_RECIPE = { parts: DEFAULT_PARTS, mutation: 'spot' };
