// Лабиринт: развилки с петлями, знаки перед ними, перекрёсток, где трасса пересекает саму себя.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getTrainingTrack, projectProgress, signAt, castSegment, pointAt, forksPassed, SIGN_VIEW } from '../../engine/track.js';
import { drawMaze, SIGN_GAP } from '../../engine/maze.js';
import { Car } from '../../engine/car.js';

const maze = getTrainingTrack('maze');
const [main, ...loops] = maze.roads;

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

test('у каждой развилки петля и знак перед ней, знаки разные — «всегда налево» не проедет', () => {
  assert.equal(loops.length, maze.signs.length);
  assert.ok(loops.length >= 3);
  loops.forEach((d, k) => {
    assert.ok(Math.abs(d.fromS - maze.signs[k].s - SIGN_GAP) < 10, 'знак за SIGN_GAP до развилки');
    assert.ok(d.toS < maze.signs[k].s - SIGN_VIEW, 'петля выводит на дорогу до знака: его видно снова');
    assert.ok(d.toS > (loops[k - 1]?.fromS ?? 0) + 300, 'и после прошлой развилки');
  });
  assert.ok(new Set(maze.signs.map((s) => s.dir)).size === 2);
});

test('петли не задевают других участков трассы и друг друга', () => {
  const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y) < maze.width;
  for (const d of loops) {
    d.center.forEach((p, k) => {
      main.center.forEach((q, i) => {
        if (near(p, q)) assert.ok(Math.abs(i - d.fromIdx) < 40 || Math.abs(i - d.toIdx) < 30, `петля у точки ${k} наезжает на дорогу у точки ${i}`);
      });
    });
    for (const e of loops) if (e !== d) assert.ok(d.center.every((p) => e.center.every((q) => !near(p, q))), 'петли не касаются');
  }
});

test('тупик зеркальный: у развилки слева и справа одинаково далеко до центра другой ветки', () => {
  for (const d of loops) {
    const k = 12; // чуть дальше развилки
    const a = pointAt(main, d.fromS + d.cum[k]), b = d.center[k];
    const mid = pointAt(main, d.fromS - 50); // на прямой перед развилкой
    assert.ok(Math.abs(Math.hypot(a.x - mid.x, a.y - mid.y) - Math.hypot(b.x - mid.x, b.y - mid.y)) < 3);
  }
});

test('на развилке, петле и перекрёстке бордюра нет: там асфальт', () => {
  const clear = (road, from, to) => {
    const c = road.center;
    for (let i = from; i < to; i++) assert.equal(castSegment(maze, c[i - 1].x, c[i - 1].y, c[i].x, c[i].y), -1, `по центру дороги стенок нет (точка ${i})`);
  };
  clear(main, 2, main.center.length - 1); // у старта и за финишем — стенки
  for (const d of loops) {
    const p = main.center[d.fromIdx], q = d.center[25];
    assert.equal(castSegment(maze, p.x, p.y, q.x, q.y), -1, 'от развилки на петлю можно проехать');
    clear(d, 1, d.center.length);
    const end = d.center.at(-1), back = main.center[d.toIdx + 5];
    assert.equal(castSegment(maze, end.x, end.y, back.x, back.y), -1, 'из петли — снова на дорогу');
  }
});

test('прогресс вдоль основной дороги растёт до финиша и не прыгает на перекрёстке', () => {
  const trip = driveAlong(main, 0, main.center.length - 1);
  assert.ok(trip.every((w) => w.road === 0), 'с основной дороги не сворачиваем');
  for (let i = 1; i < trip.length; i++) assert.ok(trip[i].s - trip[i - 1].s < 30, `скачок прогресса на точке ${i}`);
  assert.ok(trip.at(-1).s >= maze.finishS);
});

test('на перекрёстке не срежешь: свернул на петлю задом наперёд — прогресс стоит', () => {
  const c = main.center;
  // перекрёсток — две точки основной дороги рядом друг с другом, но далеко по пути
  let i = 0, j = 0;
  for (let a = 0; a < c.length && !j; a++) {
    for (let b = a + 60; b < c.length; b++) if (Math.hypot(c[a].x - c[b].x, c[a].y - c[b].y) < 8) { i = a; j = b; break; }
  }
  assert.ok(j > 0, 'в лабиринте есть перекрёсток');
  let where = { road: 0, idx: 0 }, most = 0;
  for (const p of [...c.slice(0, i + 1), ...c.slice(i + 20, j + 1).reverse()]) {
    where = projectProgress(maze, p.x, p.y, where.idx, where.road);
    most = Math.max(most, where.s);
  }
  assert.ok(most < main.cum[i] + 40, `прогресс ушёл до ${Math.round(most)}, а перекрёсток на ${Math.round(main.cum[i])}`);
});

test('развилка засчитывается, только если проехал за неё, а не в тупик', () => {
  const [first, second] = loops;
  assert.equal(forksPassed(maze, first.fromS - 10), 0);
  assert.equal(forksPassed(maze, first.fromS + 180), 0, 'из тупика прогресс так далеко не уходит');
  assert.equal(forksPassed(maze, (first.fromS + second.fromS) / 2), 1);
  assert.equal(forksPassed(maze, maze.finishS), loops.length);
});

test('на петле прогресс только падает — до того места, где она выходит на дорогу', () => {
  for (const d of loops) {
    let where = { road: 0, idx: d.fromIdx };
    const seen = [];
    // по петле, а потом ещё немного по дороге после неё
    for (const p of [...d.center, ...main.center.slice(d.toIdx + 1, d.toIdx + 10)]) {
      where = projectProgress(maze, p.x, p.y, where.idx, where.road);
      seen.push(where);
    }
    assert.ok(seen.every((w) => w.s <= d.fromS + 40), 'на петле прогресс не больше, чем у развилки');
    for (let i = 1; i < seen.length; i++) assert.ok(seen[i].s - seen[i - 1].s < 30, `скачок прогресса на точке ${i}`);
    assert.equal(seen.at(-1).road, 0, 'в конце петли машина снова на дороге');
    assert.ok(Math.abs(seen.at(-1).s - main.cum[d.toIdx + 9]) < 30);
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

/** Машина с простым водителем: смотрит на точку пути в 25 px впереди и рулит к ней. Едет, пока until() не скажет «хватит» */
function follow(path, until = () => false) {
  const sensors = { count: 5, spread: 90, length: 160 };
  let car = null, k = 8; // первая цель — чуть впереди старта
  const think = () => {
    while (k < path.length - 1 && Math.hypot(path[k].x - car.x, path[k].y - car.y) < 25) k++;
    let turn = Math.atan2(path[k].y - car.y, path[k].x - car.x) - car.angle;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    const limit = Math.abs(turn) > 0.25 ? 1.2 : 2.6;
    return [car.speed < limit ? 1 : 0, car.speed > limit + 0.3 ? 1 : 0, turn < -0.03 ? 1 : 0, turn > 0.03 ? 1 : 0, 0, 0, 0];
  };
  car = new Car(maze, { brain: {}, think, sensors });
  let signs = 0, prev = 0, onLoop = false;
  while (!car.done && !until(car, onLoop)) {
    car.step(maze);
    const sign = car.lastInputs[2 * sensors.count + 1];
    if (sign && !prev) signs++;
    prev = sign;
    onLoop ||= car.road > 0;
  }
  return { car, signs, onLoop };
}

test('свернул не туда — не авария: объехал петлю, снова увидел знак и поехал дальше', () => {
  const d = loops[0];
  const path = [...main.center.slice(0, d.fromIdx), ...d.center, ...main.center.slice(d.toIdx + 1)];
  const { car, signs, onLoop } = follow(path, (c, looped) => looped && c.road === 0 && c.s > d.fromS + 400);
  assert.equal(car.status, 'driving', 'машина не заглохла и не разбилась');
  assert.ok(onLoop, 'машина проехала по петле');
  assert.equal(signs, 2, 'знак она видела дважды: до петли и после');
  assert.equal(car.detours, 1, 'одна петля — один круг ошибки');
});

test('кто всегда сворачивает верно, доезжает без кругов по петле', () => {
  const { car, signs } = follow(main.center);
  assert.equal(car.status, 'finished');
  assert.equal(car.detours, 0);
  assert.equal(signs, maze.signs.length);
});
