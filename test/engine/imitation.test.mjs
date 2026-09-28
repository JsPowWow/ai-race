// Обучение на примерах: сеть учится повторять за «учителем».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBrain } from '../../engine/brain.js';
import { trainEpoch, agreement, packSample, unpackSample } from '../../engine/imitation.js';
import { mulberry32 } from '../../engine/utils.js';

test('пример упаковывается в строку и обратно почти без потерь', () => {
  const sample = { x: [0, 0.25, 0.5, 1, 0.8, -0.3], y: [1, 0, 0, 1] };
  const back = unpackSample(packSample(sample));
  assert.deepEqual(back.y, sample.y);
  back.x.forEach((v, i) => assert.ok(Math.abs(v - sample.x[i]) < 0.02, `вход ${i}`));
});

test('после нескольких эпох сеть чаще соглашается с учителем', () => {
  // Учитель: «впереди близко (сенсор 3 > 0.5) — тормози, иначе газ»
  const rnd = mulberry32(7);
  const samples = Array.from({ length: 200 }, () => {
    const x = [rnd(), rnd(), rnd(), rnd(), rnd(), rnd()];
    const close = x[2] > 0.5;
    return { x, y: [close ? 0 : 1, close ? 1 : 0, 0, 0] };
  });
  const brain = createBrain([6, 6, 4], mulberry32(1));
  const before = agreement(brain, samples);
  for (let epoch = 0; epoch < 30; epoch++) trainEpoch(brain, samples, 0.1, mulberry32(epoch));
  assert.ok(agreement(brain, samples) > before, `было ${before}`);
});
