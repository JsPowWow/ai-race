// Очки сборки (#19): у всех один бюджет, «всё на максимум» не купить — приходится выбирать.
// Цена — чистая функция формы машины: её пересчитывают «Гонка» и финал (checkCar), подделать её в файле нельзя.

export const BUDGET = 100;

/** Цены. Угол обзора бесплатный: широкий веер видит бока, узкий — центр, это выбор, а не покупка */
export const PRICES = {
  sensor: 6,      // сенсор вперёд
  reach: 1,       // +10 px дальности сенсоров вперёд сверх 80 px
  back: 6,        // сенсор назад
  backReach: 1,   // +10 px дальности сенсоров назад сверх 40 px
  neuron: 2,      // нейрон скрытого слоя
  layer: 5,       // каждый скрытый слой после первого
};

/**
 * Сколько очков стоит сборка.
 * @param {{ sensors: { count: number, length: number, back?: number, backLength?: number }, hidden: number[] }} config
 */
export function cost({ sensors, hidden }) {
  const back = sensors.back ?? 0;
  const neurons = hidden.reduce((sum, n) => sum + n, 0);
  return (
    sensors.count * PRICES.sensor +
    Math.ceil((sensors.length - 80) / 10) * PRICES.reach +
    back * PRICES.back +
    (back ? Math.ceil((sensors.backLength - 40) / 10) * PRICES.backReach : 0) +
    neurons * PRICES.neuron +
    Math.max(0, hidden.length - 1) * PRICES.layer
  );
}
