// Числа и слова для людей: десятичная запятая, секунды из тиков, размер файла, «1 заезд — 5 заездов».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { num, secs, pct, bytes, plural } from '../../app/format.ts';

test('число — с запятой, как пишут по-русски', () => {
  assert.equal(num(12.44), '12,4');
  assert.equal(num(3, 2), '3,00');
  assert.equal(num(-0.25, 1), '-0,3');
});

test('тики — в секунды: 60 тиков = 1 с', () => {
  assert.equal(secs(746), '12,4 с');
  assert.equal(secs(90, 2), '1,50 с');
  assert.equal(pct(41.6), '42%');
});

test('размер файла: байты, КБ, МБ', () => {
  assert.equal(bytes(512), '512 Б');
  assert.equal(bytes(1536), '1,5 КБ');
  assert.equal(bytes(3 * 1024 * 1024), '3,0 МБ');
});

test('форма слова по числу', () => {
  const runs = (n) => `${n} ${plural(n, 'заезд', 'заезда', 'заездов')}`;
  assert.deepEqual([1, 2, 5, 11, 21, 22, 112].map(runs), ['1 заезд', '2 заезда', '5 заездов', '11 заездов', '21 заезд', '22 заезда', '112 заездов']);
});
