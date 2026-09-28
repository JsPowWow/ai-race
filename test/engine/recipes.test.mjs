// Фитнес по галочкам: основа — расстояние, каждая галочка — одна поправка.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitnessOf } from '../../engine/recipes.ts';

const crashed = { progress: 1000, finished: false, crashed: true, ticks: 900, wiggle: 10 };
const finished = { progress: 3000, finished: true, crashed: false, ticks: 5000, wiggle: 10 };

test('без галочек хвалим только за расстояние', () => {
  assert.equal(fitnessOf([])(crashed), 1000);
  assert.equal(fitnessOf([])(finished), 3000);
});

test('каждая галочка добавляет свою поправку', () => {
  assert.equal(fitnessOf(['careful'])(crashed), 500);
  assert.equal(fitnessOf(['finish'])(finished), 3000 + 15000);
  assert.equal(fitnessOf(['smooth'])(finished), 3000 - 50);
});

test('галочки складываются, порядок выбора не важен', () => {
  assert.equal(fitnessOf(['finish', 'careful'])(finished), 18000);
  assert.equal(fitnessOf(['smooth', 'careful'])(crashed), 450);
});

test('кто быстрее доехал, тот лучше — только с бонусом за время', () => {
  const slow = { ...finished, ticks: 6000 };
  assert.ok(fitnessOf(['finish'])(finished) > fitnessOf(['finish'])(slow));
  assert.equal(fitnessOf([])(finished), fitnessOf([])(slow));
});
