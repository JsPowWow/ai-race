// «Табло мозга» без браузера: раскладка, формула нейрона и «теплота» — чистые функции (app/brain-board/*.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBrain, layerSizes, BUTTONS, NOTES } from '../engine/net/brain.ts';
import { mulberry32 } from '../engine/core/utils.ts';
import { thinkVariants, feedForward } from '../student/think.js';
import { layout, neuronAt, sensorAt, buttonCenterX } from '../app/brain-board/layout.ts';
import { neuronFormula, SMOOTH, TOP_TERMS } from '../app/brain-board/formula.ts';
import { createGlow, stepGlow } from '../app/brain-board/glow.ts';
import { labelsFor } from '../app/brain-board/labels.ts';

const SENSORS = 7;
const sizes = layerSizes(SENSORS, [8]);
const brain = createBrain(sizes, mulberry32(7), 0); // заметки тоже со связями — формуле есть что показать
const rnd = mulberry32(11);
const inputs = Array.from({ length: sizes[0] }, () => rnd());
thinkVariants.smooth.think(inputs, brain);
const trace = feedForward.lastTrace;
const labels = labelsFor(sizes, SMOOTH);
const names = { inputNames: labels.inputs, outNames: labels.outputs, act: SMOOTH };
/** «+0.40» → 0.4 */
const num = (s) => Number(s.replace('−', '-'));

test('формула: слагаемые и «и ещё …» складываются ровно в сумму, ответ — настоящий', () => {
  for (let k = 1; k < sizes.length; k++) {
    for (let i = 0; i < sizes[k]; i++) {
      const f = neuronFormula(brain, trace, k, i, names);
      assert.ok(f.terms.length <= TOP_TERMS);
      const products = f.terms.map((t) => num(t.math.split('= ')[1]));
      const rest = f.rest ? num(f.rest.split('= ')[1]) : 0;
      const sum = num(f.sum.split(' ')[1]);
      assert.ok(Math.abs(products.reduce((s, p) => s + p, 0) + rest - sum) < 0.005, `нейрон ${k}/${i}: столбик не сходится`);
      const value = trace[k][i];
      if (k === sizes.length - 1) assert.equal(f.value, `${Math.round(value * 100)}%`);
      else assert.ok(Math.abs(num(f.value.replace('+.', '+0.').replace('−.', '−0.')) - value) < 0.006);
    }
  }
});

test('формула: кнопки и заметки подписаны по-человечески, единица пишется как 1.0', () => {
  const last = sizes.length - 1;
  assert.equal(neuronFormula(brain, trace, last, 0, names).title, 'Кнопка «Газ»');
  assert.equal(neuronFormula(brain, trace, last, 4, names).title, 'Заметка m1');
  assert.equal(neuronFormula(brain, trace, 1, 2, names).title, 'Нейрон 3');
  const full = trace.map((layer) => [...layer]);
  full[0] = full[0].map(() => 1);
  const f = neuronFormula(brain, full, 1, 0, names);
  assert.ok(f.terms.every((t) => t.math.startsWith('+1.0 × ')), 'вход 1 — не «+.99»: иначе «× вес = вклад» не сходится');
});

test('раскладка: всё внутри холста, заметки на выходе — в тех же строках, что на входе', () => {
  for (const [W, H] of [[1300, 580], [360, 620]]) {
    const lay = layout(sizes, SENSORS, NOTES, W, H);
    for (const col of lay.pos) for (const [x, y] of col) assert.ok(x > 0 && x < W && y > 0 && y < H);
    const ins = lay.pos[0], outs = lay.pos[sizes.length - 1];
    for (let m = 0; m < NOTES; m++) assert.equal(outs[lay.buttons + m][1], ins[ins.length - NOTES + m][1]);
    assert.equal(lay.narrow, W < 640);
    assert.deepEqual(lay.boxes.map((b) => b.id), ['input', 'notesIn', 'hidden0', 'buttons', 'notesOut']);
  }
});

test('указатель: нейрон, кнопка и сенсор находятся по своему месту, пустое место — ничего', () => {
  const lay = layout(sizes, SENSORS, NOTES, 1300, 580);
  const [hx, hy] = lay.pos[1][3];
  assert.deepEqual(neuronAt(lay, hx + 2, hy - 2), { k: 1, i: 3 });
  const [bx, by] = lay.pos[2][1];
  assert.deepEqual(neuronAt(lay, buttonCenterX(lay, bx) + 30, by), { k: 2, i: 1 }, 'кнопка «Тормоз» — по всей ширине');
  assert.equal(neuronAt(lay, 5, 5), null);
  assert.equal(neuronAt(lay, ...lay.pos[0][0]), null, 'у входов формулы нет');
  assert.equal(sensorAt(lay, ...lay.pos[0][2]), 2);
  assert.equal(sensorAt(lay, ...lay.pos[0][SENSORS]), -1, 'скорость не нажимается');
  assert.equal(sensorAt(lay, ...lay.pos[0][SENSORS + 1]), -1, 'и «мгновение назад» тоже');
});

test('теплота: вспыхивает быстро, гаснет медленно; кадр не заводит новых массивов', () => {
  const glow = createGlow(sizes);
  const arrays = [...glow.edgeHeat, ...glow.nodeHeat, ...glow.signal, ...glow.shown];
  const lit = trace.map((layer) => layer.map(() => 1));
  const dark = trace.map((layer) => layer.map(() => 0));
  stepGlow(glow, brain, lit, 1 / 60, 0, false);
  const afterOne = glow.nodeHeat[1][0];
  for (let f = 1; f < 10; f++) stepGlow(glow, brain, lit, 1 / 60, f * 16, false);
  assert.ok(glow.nodeHeat[1][0] > 0.9, 'за 10 кадров разгорелся');
  assert.ok(afterOne > 0.3, 'вспыхивает с первого кадра');
  stepGlow(glow, brain, dark, 1 / 60, 200, false);
  assert.ok(glow.nodeHeat[1][0] > 0.85, 'за один кадр не гаснет');
  assert.deepEqual([...glow.edgeHeat, ...glow.nodeHeat, ...glow.signal, ...glow.shown], arrays);
  assert.equal(glow.pulses.length, 0, 'просят поменьше движения — импульсов нет');
});

test('теплота: подписи — «+.42» у нейронов, проценты у кнопок, 10 раз в секунду', () => {
  const glow = createGlow(sizes);
  const last = sizes.length - 1;
  stepGlow(glow, brain, trace, 1 / 60, 0, true, mulberry32(1));
  assert.equal(glow.readout[last][0], `${Math.round(trace[last][0] * 100)}%`);
  assert.match(glow.readout[1][0], /^[+−]\.\d\d$/);
  assert.match(glow.readout[last][BUTTONS.length], /^[+−]\.\d\d$/, 'заметка — числом, не процентом');
  const before = glow.readout[1][0];
  stepGlow(glow, brain, trace.map((l) => l.map((v) => -v)), 1 / 60, 50, true, mulberry32(1));
  assert.equal(glow.readout[1][0], before, 'через 50 мс подпись ещё прежняя');
});

// На паузе роя табло зовут каждый кадр с тем же ходом мысли, но время для него стоит (dt = 0):
// импульсы не должны рождаться и бежать — иначе кажется, что мозг думает, хотя машина стоит.
test('импульсы: время стоит — ни новых, ни бегущих; рождаются по времени, а не по кадрам', () => {
  const glow = createGlow(sizes);
  const lit = trace.map((layer) => layer.map(() => 1));
  const random = mulberry32(3);
  for (let f = 0; f < 30; f++) stepGlow(glow, brain, lit, 1 / 60, f * 16, true, random);
  const running = glow.pulses.map((p) => p.t);
  assert.ok(running.length > 0, 'пока время идёт, импульсы бегут');
  for (let f = 0; f < 300; f++) stepGlow(glow, brain, lit, 0, 500 + f * 16, true, random);
  assert.deepEqual(glow.pulses.map((p) => p.t), running, 'пауза: те же импульсы на тех же местах');
  // одна секунда — одинаково импульсов при 60 и 120 кадрах в секунду (в среднем)
  const perSecond = (fps) => {
    let born = 0;
    for (let run = 0; run < 20; run++) {
      const g = createGlow(sizes), r = mulberry32(run + 1);
      for (let f = 0; f < fps; f++) {
        const before = g.pulses.length;
        stepGlow(g, brain, lit, 1 / fps, f, true, r);
        born += Math.max(0, g.pulses.length - before);
      }
    }
    return born / 20;
  };
  const [at60, at120] = [perSecond(60), perSecond(120)];
  assert.ok(Math.abs(at120 - at60) < at60 * 0.35, `60 Гц: ${at60}, 120 Гц: ${at120}`);
});
