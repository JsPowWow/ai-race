// Хранение «мозга»: просто числа в массивах.
//
// brain = {
//   layers: [
//     { weights: [[...], ...],  // weights[i][j]: связь нейрона i → нейрон j следующего слоя
//       biases:  [...] },       // biases[j]: порог нейрона j
//     ...
//   ]
// }

// Форма мозга одна на весь курс:
//   входы  = сенсоры сейчас (s1…sn), скорость (v), сенсоры мгновение назад (s1′…sn′), дорожный знак (зн), заметки (m1…m3);
//   выходы = 4 кнопки пульта и 3 новые заметки.
// Заметки — память, которую мозг ведёт сам: что выдал в m1…m3 на этом тике, то увидит на входе в следующем.
// Так он может «помнить» дольше мгновения («был знак направо»). Заметки всегда последние.
// Знак: -1 — «свободно налево», 1 — «направо», 0 — знака рядом нет или он погас (стоит перед развилкой-островом, см. track.js).
export const BUTTONS = ['Газ', 'Тормоз', 'Влево', 'Вправо'];
export const NOTES = 3;
export const NOTE_LABELS = Array.from({ length: NOTES }, (_, i) => `m${i + 1}`);
export const OUTPUT_LABELS = [...BUTTONS, ...NOTE_LABELS];
export const OUTPUTS = OUTPUT_LABELS.length;

export const LIMITS = { sensorsMin: 3, sensorsMax: 15, hiddenLayersMax: 3, neuronsMin: 2, neuronsMax: 16 };

export const SIGN_LABEL = 'зн';

/** Сколько входов у сети при n сенсорах: сейчас, скорость, мгновение назад, знак, заметки */
export const inputCount = (sensorCount) => 2 * sensorCount + 2 + NOTES;

/** Сколько сенсоров у сети с таким числом входов */
export const sensorsOf = (inputs) => (inputs - 2 - NOTES) / 2;

/** Подписи входов: s1…sn, v, s1′…sn′, зн, m1…m3 */
export function inputLabels(sensorCount) {
  const now = Array.from({ length: sensorCount }, (_, i) => `s${i + 1}`);
  return [...now, 'v', ...now.map((s) => `${s}′`), SIGN_LABEL, ...NOTE_LABELS];
}

/** Подпись входа i у сети с sizes0 входами (s3, v, s3′, зн, m1); если форма не наша — просто номер */
export function inputLabel(sizes0, i) {
  const n = sensorsOf(sizes0);
  return Number.isInteger(n) && n > 0 ? inputLabels(n)[i] : `вход ${i + 1}`;
}

/** Размеры слоёв: входы, дальше скрытые, в конце кнопки и заметки */
export const layerSizes = (sensorCount, hidden) => [inputCount(sensorCount), ...hidden, OUTPUTS];

/**
 * Новый мозг со случайными числами. Веса от последних silentInputs входов (заметок) — нули:
 * пока рой не научит мозг пользоваться заметками, они ни на что не влияют.
 */
export function createBrain(sizes, rnd = Math.random, silentInputs = NOTES) {
  const layers = [];
  for (let k = 0; k < sizes.length - 1; k++) {
    const silentFrom = k === 0 ? sizes[0] - silentInputs : Infinity;
    layers.push({
      weights: Array.from({ length: sizes[k] }, (_, i) => Array.from({ length: sizes[k + 1] }, () => (i >= silentFrom ? 0 : rnd() * 2 - 1))),
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
