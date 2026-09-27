// Хранение «мозга»: просто числа в массивах.
//
// brain = {
//   layers: [
//     { weights: [[...], ...],  // weights[i][j]: связь нейрона i → нейрон j следующего слоя
//       biases:  [...] },       // biases[j]: порог нейрона j
//     ...
//   ]
// }

export const OUTPUT_LABELS = ['Газ', 'Тормоз', 'Влево', 'Вправо'];
export const OUTPUTS = OUTPUT_LABELS.length;

export const LIMITS = { sensorsMin: 3, sensorsMax: 15, hiddenLayersMax: 3, neuronsMin: 2, neuronsMax: 16 };

/** Размеры слоёв: входы = сенсоры + скорость, дальше скрытые, в конце 4 выхода */
export const layerSizes = (sensorCount, hidden) => [sensorCount + 1, ...hidden, OUTPUTS];

export function createBrain(sizes, rnd = Math.random) {
  const layers = [];
  for (let k = 0; k < sizes.length - 1; k++) {
    layers.push({
      weights: Array.from({ length: sizes[k] }, () => Array.from({ length: sizes[k + 1] }, () => rnd() * 2 - 1)),
      biases: Array.from({ length: sizes[k + 1] }, () => rnd() * 2 - 1),
    });
  }
  return { layers };
}

export const cloneBrain = (brain) => JSON.parse(JSON.stringify(brain));

export function brainSizes(brain) {
  return [brain.layers[0].weights.length, ...brain.layers.map((l) => l.biases.length)];
}

/** Проверка, что мозг подходит под заявленные размеры. Возвращает текст ошибки или null. */
export function checkBrain(brain, sizes) {
  if (!brain || !Array.isArray(brain.layers)) return 'нет brain.layers';
  if (brain.layers.length !== sizes.length - 1) return `слоёв ${brain.layers.length}, ожидалось ${sizes.length - 1}`;
  for (let k = 0; k < brain.layers.length; k++) {
    const { weights, biases } = brain.layers[k];
    if (!Array.isArray(weights) || weights.length !== sizes[k]) return `слой ${k + 1}: неверное число строк весов`;
    if (!Array.isArray(biases) || biases.length !== sizes[k + 1]) return `слой ${k + 1}: неверное число порогов`;
    for (const row of weights) {
      if (!Array.isArray(row) || row.length !== sizes[k + 1]) return `слой ${k + 1}: неверная длина строки весов`;
      if (!row.every(Number.isFinite)) return `слой ${k + 1}: в весах не числа`;
    }
    if (!biases.every(Number.isFinite)) return `слой ${k + 1}: в порогах не числа`;
  }
  return null;
}
