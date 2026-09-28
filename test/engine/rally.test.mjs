// Правила финала: время этапа, штраф за сход, места с ничьими.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stageTime, standings, STAGES, stageTrack, hardStages } from '../../engine/rally.ts';

const finished = (seconds) => ({ status: 'finished', finishTick: seconds * 60, limit: 60 * 60, progress: 1 });
const crashed = (progress) => ({ status: 'crashed', finishTick: null, limit: 60 * 60, progress });

test('финиш — это время финиша в секундах', () => {
  assert.equal(stageTime(finished(42)), 42);
});

test('любой финиш лучше любого схода, а из сошедших выше тот, кто проехал дальше', () => {
  const slowFinish = stageTime(finished(59));
  const almostFinished = stageTime(crashed(0.99));
  const earlyCrash = stageTime(crashed(0.1));
  assert.ok(slowFinish < almostFinished);
  assert.ok(almostFinished < earlyCrash);
});

test('не посчитали (завис код) — в самый конец', () => {
  assert.equal(stageTime({ status: 'hung', limit: 0 }), Infinity);
});

test('одинаковая сумма — одно место: 1, 2, 2, 4', () => {
  const entries = ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id }));
  const times = { a: 30, b: 40, c: 40, d: 50 };
  const results = Array.from({ length: STAGES }, () => new Map(entries.map((e) => [e.id, finished(times[e.id])])));
  const rows = standings(entries, results, STAGES);
  assert.deepEqual(rows.map((r) => [r.entry.id, r.place]), [['a', 1], ['b', 2], ['c', 2], ['d', 4]]);
});

test('снятые участники в зачёт не идут', () => {
  const entries = [{ id: 'a', name: 'a' }, { id: 'b', name: 'b', dq: true }];
  const results = Array.from({ length: STAGES }, () => new Map(entries.map((e) => [e.id, finished(30)])));
  assert.deepEqual(standings(entries, results, STAGES).map((r) => r.entry.id), ['a']);
});

test('страховка куратора: этап, где не доехал никто, помечен трудным', () => {
  const tracks = [stageTrack('страховка · этап 1'), stageTrack('страховка · этап 2')];
  const standing = { brain: {}, think: () => [0, 1, 0, 0, 0, 0, 0], sensors: { count: 5, spread: 90, length: 160 } };
  assert.deepEqual(hardStages(tracks, [standing]), [0, 1], 'кто стоит на месте, не доедет никуда');
  assert.deepEqual(hardStages(tracks, []), [0, 1]);
});
