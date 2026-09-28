// ════════════════════════════════════════════════════════════════
//  ЗАДАНИЕ 2. МОЗГ МАШИНЫ: как из показаний сенсоров получить решение
// ════════════════════════════════════════════════════════════════
//
//  inputs — массив чисел, по порядку (при 7 сенсорах — 18 чисел):
//           s1…s7   сенсоры слева направо: 0 — ничего не видно, 1 — стена или машина вплотную;
//           v       скорость;
//           s1′…s7′ те же сенсоры мгновение назад — видно, приближается ли стена;
//           m1…m3   заметки: что мозг сам себе «записал» на прошлом шаге (на старте нули).
//  brain  — веса и пороги. brain.layers[k].weights[i][j] — сила связи
//           от нейрона i к нейрону j следующего слоя, biases[j] — порог нейрона j.
//  Ответ  — 7 чисел от 0 до 1: [газ, тормоз, влево, вправо, m1, m2, m3].
//           Первые 4 — кнопки пульта, последние 3 — новые заметки: на следующем шаге они придут на вход.
//
//  Все варианты ниже отличаются только тем, что нейрон делает со своей суммой.
//  Вариант выбирается на вкладке «Я учу». Обученные веса подходят к любому.

import { sigmoid } from '../engine/utils.js';

// Прямой проход: слой за слоем считаем для каждого нейрона сумму «вход × вес»
// и отдаём её функции activate(sum, bias, isOutput) — она решает, что нейрон «скажет» дальше.
// isOutput = true для последнего слоя (газ, тормоз, влево, вправо).
export function feedForward(inputs, brain, activate) {
  let values = inputs;
  const trace = [inputs];
  brain.layers.forEach((layer, k) => {
    const isOutput = k === brain.layers.length - 1;
    const next = [];
    for (let j = 0; j < layer.biases.length; j++) {
      let sum = 0;
      for (let i = 0; i < values.length; i++) {
        sum += values[i] * layer.weights[i][j];
      }
      next.push(activate(sum, layer.biases[j], isOutput));
    }
    values = next;
    trace.push(values);
  });
  feedForward.lastTrace = trace;
  return values;
}
// Последний проход по всем слоям — по нему «Я учу» подсвечивает нейроны на схеме
feedForward.lastTrace = null;

export const thinkVariants = {
  noBias: {
    title: 'Без порогов',
    hint: 'Нейрон срабатывает, если сумма больше нуля, порогов нет. Загадка: что сделает машина, когда сенсоры ничего не видят?',
    think(inputs, brain) {
      return feedForward(inputs, brain, (sum) => (sum > 0 ? 1 : 0));
    },
  },

  step: {
    title: 'Ступенька',
    hint: 'Классика: сумма больше порога — 1, иначе 0. Едет, но руль только «до упора» или «никак».',
    think(inputs, brain) {
      return feedForward(inputs, brain, (sum, bias) => (sum > bias ? 1 : 0));
    },
  },

  smooth: {
    title: 'Плавный',
    hint: 'Вместо ступеньки — плавные кривые: ответ — сила нажатия от 0 до 1. Учится дольше, зато рулит мягче.',
    think(inputs, brain) {
      // Внутри сети tanh (от -1 до 1), на выходе сигмоида (от 0 до 1).
      // Множители 2 и 3 — «крутизна» кривой. Попробуй поменять в своём варианте.
      return feedForward(inputs, brain, (sum, bias, isOutput) =>
        isOutput ? sigmoid(3 * (sum - bias)) : Math.tanh(2 * (sum - bias)),
      );
    },
  },

  winner: {
    title: 'Победитель забирает всё',
    hint: 'Считаем плавно, но жмём только одну кнопку — самую сильную. Где это хорошо, а где плохо?',
    think(inputs, brain) {
      const out = feedForward(inputs, brain, (sum, bias, isOutput) =>
        isOutput ? sigmoid(3 * (sum - bias)) : Math.tanh(2 * (sum - bias)),
      );
      const buttons = out.slice(0, 4); // заметки (после кнопок) не соревнуются — их передаём как есть
      const best = buttons.indexOf(Math.max(...buttons));
      return out.map((v, i) => (i < 4 ? (i === best ? 1 : 0) : v));
    },
  },

  mine: {
    title: 'Мой вариант',
    hint: 'Придумай свой. Правила: столько чисел от 0 до 1, сколько выходов (4 кнопки и заметки), без Math.random, быстро.',
    think(inputs, brain) {
      // TODO: придумай свой способ думать. Идеи:
      //  • другая функция: Math.tanh(sum - bias) * 0.5 + 0.5
      //  • «мёртвая зона»: если сумма чуть-чуть больше порога — жать вполсилы
      //  • поправить ответ после feedForward: не жать газ и тормоз одновременно
      //  • скорость — сразу после сенсоров: inputs[7] при 7 сенсорах. Можно сбрасывать газ, если едем слишком быстро
      //  • сравни inputs[3] и inputs[11] (сенсор 4 сейчас и мгновение назад): стена приближается — тормози
      return feedForward(inputs, brain, (sum, bias) => (sum > bias ? 1 : 0));
    },
  },
};

export const DEFAULT_THINK = 'step';
