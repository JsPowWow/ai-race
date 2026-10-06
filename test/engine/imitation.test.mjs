// Обучение на примерах: сеть учится повторять за «учителем».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBrain } from '../../engine/net/brain.ts';
import { trainEpoch, agreement, packSample, unpackSample, sampleOf, worthLearning } from '../../engine/learn/imitation.ts';
import { Car, maxTicksFor } from '../../engine/world/car.ts';
import { getTrainingTrack } from '../../engine/world/track.ts';
import { mulberry32 } from '../../engine/core/utils.ts';

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

// Призрак на «Я учу» (#10) повторяет твой заезд по записи нажатий — это работает, только если запись полная,
// а мир детерминирован: те же нажатия с того же места — та же дорога, тик в тик.
test('запись нажатий повторяет заезд тик в тик: призрак финиширует там же и тогда же', () => {
  const track = getTrainingTrack('warmup');
  const sensors = { count: 5, spread: 90, length: 160 };
  // «аккуратный ученик»: рулит туда, где стена дальше, газует до умеренной скорости
  const careful = (x) => {
    const [l2, l1, front, r1, r2] = x, speed = x[5], target = 0.6 * (1 - 0.8 * front);
    const left = l2 + l1 * 1.5, right = r2 + r1 * 1.5;
    return [speed < target ? 1 : 0, speed > target + 0.2 ? 1 : 0, right > left + 0.05 ? 1 : 0, left > right + 0.05 ? 1 : 0];
  };
  const human = new Car(track, { brain: { layers: [] }, think: careful, sensors });
  const packed = [];
  while (!human.done) {
    human.step(track, maxTicksFor(track), null);
    const s = sampleOf(human);
    if (worthLearning(s)) packed.push(packSample(s)); // как record() на «Я учу»
  }
  assert.equal(human.status, 'finished');
  const presses = packed.map((p) => unpackSample(p).y);
  let tick = 0;
  const ghost = new Car(track, { brain: { layers: [] }, think: () => presses[tick++] ?? [0, 0, 0, 0], sensors });
  while (!ghost.done) ghost.step(track, maxTicksFor(track), null);
  assert.equal(ghost.status, 'finished');
  assert.equal(ghost.ticks, human.ticks);
  assert.deepEqual([ghost.x, ghost.y], [human.x, human.y]);
});
