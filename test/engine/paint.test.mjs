// Оттенки цвета: тень и блик смешиваются заранее — одна заливка вместо двух-трёх.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseColor, tint, clearOf } from '../../engine/paint.ts';

test('цвет холста разбирается во всех видах, что отдаёт браузер', () => {
  assert.deepEqual(parseColor('#fff'), [255, 255, 255, 1]);
  assert.deepEqual(parseColor('#18191d'), [24, 25, 29, 1]);
  assert.deepEqual(parseColor('rgb(209, 31, 40)'), [209, 31, 40, 1]);
  assert.deepEqual(parseColor('rgba(0, 0, 0, 0.22)'), [0, 0, 0, 0.22]);
  assert.deepEqual(parseColor('rgb(34 44 58 / 0.5)'), [34, 44, 58, 0.5]);
  assert.equal(parseColor('oklch(0.7 0.1 200)'), null);
});

test('тень — как полупрозрачный чёрный поверх, блик — как белый поверх', () => {
  assert.equal(tint('rgb(200, 100, 50)', 0.5), 'rgb(100 50 25)');
  assert.equal(tint('rgb(0, 0, 0)', 0, 0.5), 'rgb(128 128 128)');
  assert.equal(tint('#ff0000', 0), '#ff0000', 'ни тени, ни блика — цвет как был');
  assert.equal(tint('oklch(0.7 0.1 200)', 0.3), null, 'не разобрать — рисуй слоями');
});

test('прозрачный край градиента — тот же цвет, а не прозрачный чёрный', () => {
  assert.equal(clearOf('rgb(236, 236, 234)'), 'rgb(236 236 234 / 0)');
});
