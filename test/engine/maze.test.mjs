// Лабиринт: развилки с тупиками, знаки перед ними, перекрёсток, где трасса пересекает саму себя.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getTrainingTrack, projectProgress, signAt, castSegment, pointAt, SIGN_VIEW } from '../../engine/track.js';
import { drawMaze, SIGN_GAP } from '../../engine/maze.js';
import { Car } from '../../engine/car.js';

const maze = getTrainingTrack('maze');
const [main, ...deadEnds] = maze.roads;

/** Проехать вдоль центральной линии дороги и собрать, что покажет projectProgress */
function driveAlong(road, from, to) {
  let where = { road: 0, idx: 0 };
  const out = [];
  for (let i = from; i <= to; i++) {
    const p = road.center[i];
    where = projectProgress(maze, p.x, p.y, where.idx, where.road);
    out.push(where);
  }
  return out;
}

test('лабиринт строится одинаково: одна программа — одна трасса', () => {
  const a = drawMaze([['line', 300], ['fork', 1], ['line', 300]]);
  const b = drawMaze([['line', 300], ['fork', 1], ['line', 300]]);
  assert.deepEqual(a, b);
  assert.equal(a.branches.length, 1);
  assert.deepEqual(a.signs.map((s) => s.dir), [1]);
});

test('у каждой развилки тупик и знак перед ней, знаки разные — «всегда налево» не проедет', () => {
  assert.equal(deadEnds.length, maze.signs.length);
  assert.ok(deadEnds.length >= 3);
  deadEnds.forEach((d, k) => assert.ok(Math.abs(d.fromS - maze.signs[k].s - SIGN_GAP) < 10, 'знак за SIGN_GAP до развилки'));
  assert.ok(new Set(maze.signs.map((s) => s.dir)).size === 2);
});

test('тупик зеркальный: у развилки слева и справа одинаково далеко до центра другой ветки', () => {
  for (const d of deadEnds) {
    const k = 12; // чуть дальше развилки
    const a = pointAt(main, d.fromS + d.cum[k]), b = d.center[k];
    const mid = pointAt(main, d.fromS - 50); // на прямой перед развилкой
    assert.ok(Math.abs(Math.hypot(a.x - mid.x, a.y - mid.y) - Math.hypot(b.x - mid.x, b.y - mid.y)) < 3);
  }
});

test('на развилке и перекрёстке бордюра нет: там асфальт', () => {
  for (const d of deadEnds) {
    const p = main.center[d.fromIdx], q = d.center[Math.min(d.center.length - 1, 25)];
    assert.equal(castSegment(maze, p.x, p.y, q.x, q.y), -1, 'от развилки в тупик можно проехать');
  }
  const c = main.center;
  for (let i = 2; i < c.length - 1; i++) assert.equal(castSegment(maze, c[i - 1].x, c[i - 1].y, c[i].x, c[i].y), -1, `по центру дороги стенок нет (точка ${i})`);
  const end = deadEnds[0].center.at(-1), before = deadEnds[0].center.at(-8);
  assert.ok(castSegment(maze, before.x, before.y, end.x + (end.x - before.x), end.y + (end.y - before.y)) >= 0, 'в конце тупика — стенка');
});

test('прогресс вдоль основной дороги растёт до финиша и не прыгает на перекрёстке', () => {
  const trip = driveAlong(main, 0, main.center.length - 1);
  assert.ok(trip.every((w) => w.road === 0), 'с основной дороги не сворачиваем');
  for (let i = 1; i < trip.length; i++) assert.ok(trip[i].s - trip[i - 1].s < 30, `скачок прогресса на точке ${i}`);
  assert.ok(trip.at(-1).s >= maze.finishS);
});

test('в тупике прогресс только падает: чем глубже заехал, тем дальше от финиша', () => {
  for (const d of deadEnds) {
    let where = { road: 0, idx: d.fromIdx };
    const seen = [];
    for (let i = 0; i < d.center.length; i++) {
      where = projectProgress(maze, d.center[i].x, d.center[i].y, where.idx, where.road);
      seen.push(where);
    }
    assert.ok(seen.at(-1).road > 0, 'машина в тупике');
    assert.ok(seen.every((w) => w.s <= d.fromS + 40), 'в тупике прогресс не больше, чем у развилки');
    assert.ok(seen.at(-1).s < d.fromS - 300);
  }
});

test('знак видно, только пока проезжаешь рядом с ним', () => {
  for (const sg of maze.signs) {
    assert.equal(signAt(maze, 0, sg.s - SIGN_VIEW / 2), sg.dir);
    assert.equal(signAt(maze, 0, sg.s + 20), 0, 'проехал знак — больше не видно');
    assert.equal(signAt(maze, 0, sg.s - SIGN_VIEW - 20), 0, 'ещё далеко');
  }
  assert.equal(signAt(getTrainingTrack('snake'), 0, 500), 0, 'на обычной трассе знаков нет');
});

test('машина видит знак на входе «зн», пока проезжает мимо него', () => {
  const sensors = { count: 5, spread: 90, length: 160 };
  const car = new Car(maze, { brain: {}, think: () => [0.6, 0, 0, 0, 0, 0, 0], sensors });
  const seen = [];
  while (!car.done && car.s < maze.signs[0].s + 50) {
    car.step(maze);
    seen.push(car.lastInputs[2 * sensors.count + 1]);
  }
  assert.ok(seen.includes(maze.signs[0].dir), 'у знака на входе его стрелка');
  assert.equal(seen.at(-1), 0, 'проехал — знак больше не виден');
  assert.equal(seen[0], 0, 'на старте знака не видно');
});
