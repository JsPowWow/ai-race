// Рецепты роя: за что хвалить машину (фитнес) и как делать детей (мутация, кроссовер).
// Выбираются на вкладке «Учится само». Каждый вариант проверен опытом: tools/swarm-check.mjs.
// Случайность здесь — только при рождении детей, не на пути заезда: заезд по-прежнему детерминирован.
import { randomGauss } from './utils.js';

/** @typedef {{ progress: number, finished: boolean, crashed: boolean, ticks: number }} Report отчёт о заезде (carReport) */

/** Бонус доехавшим: на три круга дают меньше 20 тыс. тиков, так что бонус всегда больше нуля и больше любого «почти» */
const finishBonus = (car) => (car.finished ? 20000 - car.ticks : 0);

/** @type {Record<string, { title: string, hint: string, fitness: (car: Report) => number }>} */
export const FITNESS = {
  fast: {
    title: 'Дальше и быстрее',
    hint: 'Кто уехал дальше, тот лучше. Доехавшим — бонус: чем быстрее, тем больше. Рой учится и доезжать, и спешить.',
    fitness: (car) => car.progress + finishBonus(car),
  },
  careful: {
    title: 'Без аварий',
    hint: 'То же, но разбившимся — половина очков. Рой осторожнее: реже бьётся о встречных, зато чуть медленнее.',
    fitness: (car) => (car.crashed ? car.progress / 2 : car.progress) + finishBonus(car),
  },
  far: {
    title: 'Только дальше',
    hint: 'Хвалим только за расстояние. Доехать научится, а спешить — нет: для него все доехавшие равны.',
    fitness: (car) => car.progress,
  },
};

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

export const DEFAULT_RECIPE = { fitness: 'fast', mutation: 'spot' };
