// Кольца и развилки-острова: трасса замыкается, прогресс идёт круг за кругом, знак и медленная зона меняются по ходу заезда.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getTrainingTrack, generateTrack, projectProgress, signAt, signShows, freeSide, zoneAt, castSegment, pointAt, forksPassed,
  lapOf, withCoins, SIGN_VIEW, SLOW_SPEED, TRAINING_TRACKS,
} from '../../engine/track.ts';
import { drawRing, SIGN_GAP } from '../../engine/turtle.ts';
import { makeTraffic, trafficAt } from '../../engine/traffic.ts';
import { Car } from '../../engine/car.ts';

const maze = getTrainingTrack('maze');
const [island] = maze.islands;
const branch = maze.roads[island.road];
const SWITCH = 600; // судьи бросают монетку раз в 10 с
const DARK = 180;   // знак гаснет за 3 с до броска

/** Проехать по точкам и собрать, что покажет projectProgress */
function drive(track, points, from = { road: 0, idx: 0, s: 0 }) {
  let where = from;
  return points.map((p) => (where = projectProgress(track, p.x, p.y, where.idx, where.road, where.s)));
}

test('черепашка замыкает кольцо: одна программа — одна трасса, конец ровно в начале', () => {
  const program = [['fit', 300], ['arc', 90, 200], ['fit', 100], ['arc', 90, 200], ['line', 300], ['arc', 90, 200], ['line', 100], ['arc', 90, 200]];
  const a = drawRing(program), b = drawRing(program);
  assert.deepEqual(a, b);
  assert.deepEqual(a.points.at(-1), a.points[0]);
  assert.throws(() => drawRing([['fit', 300], ['arc', 90, 200], ['fit', 300]]), /360/, 'кольцо, которое не поворачивает на 360°, — ошибка в программе');
});

test('учебные трассы — кольца без тесноты, по кругу 2–4 тыс. px', () => {
  for (const { id } of TRAINING_TRACKS) {
    const t = getTrainingTrack(id);
    assert.ok(t.closed && t.lap > 2000 && t.lap < 4000, `${id}: круг ${Math.round(t.lap)} px`);
    assert.equal(t.finishS, t.laps * t.lap);
    if (!t.islands.length) assert.equal(t.walls.length, 2, `${id}: бордюр внутри и снаружи, кольцо нигде не касается себя`);
  }
  assert.equal(maze.islands.length, 1, 'на «Развилке» один остров');
});

test('трассы по seed строятся всегда: кольцо, на нём остров, шире, чем выше', () => {
  for (let i = 0; i < 60; i++) {
    const t = generateTrack(`seed-${i}`);
    assert.equal(t.islands.length, 1);
    assert.ok(t.lap > 2500 && t.lap < 5000, `seed-${i}: круг ${Math.round(t.lap)} px`);
    assert.ok(t.bbox.maxX - t.bbox.minX >= t.bbox.maxY - t.bbox.minY - 1, `seed-${i}: кольцо лежит набок`);
  }
  assert.deepEqual(generateTrack('урок-1').center, generateTrack('урок-1').center);
});

test('по центру любой дороги бордюров нет: кольцо и оба пути острова проезжаются насквозь', () => {
  for (const road of maze.roads) {
    const c = road.center;
    for (let i = 1; i < c.length; i++) assert.equal(castSegment(maze, c[i - 1].x, c[i - 1].y, c[i].x, c[i].y), -1, `стенка на точке ${i}`);
  }
});

test('прогресс идёт круг за кругом: через стартовую черту без скачка, три круга — финиш', () => {
  const ring = maze.center.slice(1); // без первой точки: она же последняя
  const trip = drive(maze, [ring, ring, ring].flat(), { road: 0, idx: 0, s: 0 });
  assert.ok(trip.every((w) => w.road === 0));
  for (let i = 1; i < trip.length; i++) assert.ok(Math.abs(trip[i].s - trip[i - 1].s - 14) < 8, `скачок прогресса на точке ${i}`);
  assert.ok(Math.abs(trip.at(-1).s - maze.finishS) < 1);
  assert.equal(lapOf(maze, maze.lap - 1), 1);
  assert.equal(lapOf(maze, maze.lap + 1), 2);
  assert.equal(lapOf(maze, maze.finishS), 3);
});

test('второй путь острова: прогресс идёт вперёд, как по кольцу, и машина возвращается на кольцо', () => {
  const before = maze.center.slice(island.sign.idx, branch.fromIdx + 1);
  const after = maze.center.slice(branch.toIdx + 1, branch.toIdx + 10);
  const trip = drive(maze, [...before, ...branch.center.slice(1), ...after], { road: 0, idx: island.sign.idx, s: island.sign.s });
  assert.ok(trip.some((w) => w.road === island.road), 'машина проехала по второму пути');
  for (let i = 1; i < trip.length; i++) assert.ok(trip[i].s - trip[i - 1].s > -1 && trip[i].s - trip[i - 1].s < 30, `скачок на точке ${i}`);
  assert.equal(trip.at(-1).road, 0);
});

test('монетка судей: одинаковая у всех, меняется не чаще раза в 10 с, выпадают обе стороны', () => {
  const sides = Array.from({ length: 60000 }, (_, t) => freeSide(maze, 0, t));
  assert.deepEqual(sides.slice(0, 2000), Array.from({ length: 2000 }, (_, t) => freeSide(getTrainingTrack('maze'), 0, t)));
  let run = 0;
  const runs = [];
  for (let t = 1; t < sides.length; t++) {
    run++;
    if (sides[t] !== sides[t - 1]) { runs.push(run); run = 0; }
  }
  assert.ok(runs.length > 20, 'путь меняется много раз за заезд');
  assert.ok(runs.slice(1).every((r) => r >= SWITCH), 'между сменами — не меньше 10 с');
  assert.deepEqual(new Set(sides), new Set([1, -1]));
});

test('серия бросков: та же трасса, но монетка другая — и каждая серия повторяется', () => {
  assert.equal(withCoins(maze, 0), maze, 'серия 0 — сама трасса');
  const sides = (track) => Array.from({ length: 40 }, (_, k) => freeSide(track, 0, k * SWITCH));
  const a = withCoins(maze, 7);
  assert.equal(a.roads, maze.roads, 'дорога та же');
  assert.deepEqual(sides(a), sides(withCoins(getTrainingTrack('maze'), 7)), 'серия 7 у всех одна и та же');
  assert.notDeepEqual(sides(a), sides(maze));
  assert.notDeepEqual(sides(a), sides(withCoins(maze, 8)));
});

test('знак горит, куда свободно, и гаснет за 3 с до смены; видно его, только пока проезжаешь рядом', () => {
  for (let t = 0; t < 20000; t += 7) {
    const now = freeSide(maze, 0, t), soon = freeSide(maze, 0, t + DARK);
    assert.equal(signShows(maze, 0, t), now === soon ? now : 0);
  }
  const lit = Array.from({ length: 3000 }, (_, t) => t).find((t) => signShows(maze, 0, t) !== 0);
  const { s } = island.sign;
  assert.equal(signAt(maze, 0, s - SIGN_VIEW / 2, lit), freeSide(maze, 0, lit));
  assert.equal(signAt(maze, 0, s - SIGN_VIEW / 2 + maze.lap, lit), freeSide(maze, 0, lit), 'и на втором круге');
  assert.equal(signAt(maze, 0, s + 20, lit), 0, 'проехал — больше не видно');
  assert.equal(signAt(maze, 0, s - SIGN_VIEW - 20, lit), 0, 'ещё далеко');
  assert.ok(Math.abs(island.forkS - s - SIGN_GAP) < 1, 'знак за SIGN_GAP до развилки: у самой развилки его уже не видно');
  assert.equal(signAt(getTrainingTrack('snake'), 0, 500, lit), 0, 'на трассе без острова знаков нет');
});

test('медленная зона — на одном из путей острова, на каждом круге', () => {
  const mid = (island.zone[0] + island.zone[1]) / 2;
  assert.deepEqual(zoneAt(maze, 0, mid), { island: 0, side: island.side });
  assert.deepEqual(zoneAt(maze, island.road, mid), { island: 0, side: -island.side });
  assert.deepEqual(zoneAt(maze, 0, mid + 2 * maze.lap), { island: 0, side: island.side });
  assert.equal(zoneAt(maze, 0, island.forkS - 10), null);
  assert.equal(forksPassed(maze, island.mergeS - 10), 0);
  assert.equal(forksPassed(maze, island.mergeS + 10), 1);
  assert.equal(forksPassed(maze, maze.finishS), maze.laps);
});

/**
 * Машина с простым водителем: смотрит на точку в 30 px впереди и рулит к ней.
 * На острове едет по пути choose(машина, что помнит со знака). Знак он запоминает, пока видит.
 */
function follow(track, choose) {
  const isl = track.islands[0], road = track.roads[isl.road];
  const sensors = { count: 5, spread: 90, length: 160 };
  let car = null, remembered = 0;
  const aim = () => {
    const s = car.s + 30, at = ((s % track.lap) + track.lap) % track.lap;
    const onIsland = at > isl.forkS && at < isl.mergeS;
    if (onIsland && choose(car, remembered) !== isl.side) return pointAt(road, ((at - isl.forkS) / (isl.mergeS - isl.forkS)) * road.total);
    return pointAt(track, s);
  };
  const think = (inputs) => {
    const sign = inputs[2 * sensors.count + 1];
    if (sign) remembered = sign;
    const p = aim();
    let turn = Math.atan2(p.y - car.y, p.x - car.x) - car.angle;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    const limit = Math.abs(turn) > 0.25 ? 1.8 : 2.6;
    return [car.speed < limit ? 1 : 0, car.speed > limit + 0.3 ? 1 : 0, turn < -0.03 ? 1 : 0, turn > 0.03 ? 1 : 0, 0, 0, 0];
  };
  car = new Car(track, { brain: {}, think, sensors });
  let slowest = Infinity;
  while (!car.done) {
    car.step(track, 20000);
    if (car.slow) slowest = Math.min(slowest, car.speed);
  }
  return { car, slowest };
}

test('кто читает знак, едет по свободному пути все три круга; кто всегда прямо — попадает в медленную зону', () => {
  const smart = follow(maze, (car, remembered) => remembered || island.side);
  assert.equal(smart.car.status, 'finished');
  assert.equal(smart.car.slowdowns, 0);
  const stubborn = follow(maze, () => island.side);
  assert.equal(stubborn.car.status, 'finished', 'медленная зона — не авария и не «заглох»');
  assert.ok(stubborn.car.slowdowns >= 1);
  assert.ok(stubborn.slowest <= SLOW_SPEED + 1e-9, 'в зоне машина ползёт');
  assert.ok(stubborn.car.ticks > smart.car.ticks, 'ошибка стоит времени');
});

test('поток трафика на острове расходится: часть машин едет по второму пути', () => {
  const traffic = makeTraffic(maze, 'all');
  const near = (road, o, d) => road.center.some((q) => Math.hypot(q.x - o.x, q.y - o.y) < d);
  const onBranch = (o) => near(branch, o, 70) && !near(maze, o, 120); // на полосе второго пути, далеко от кольца
  let seen = 0;
  for (let t = 0; t < 3000; t += 10) seen += trafficAt(maze, traffic, t).filter(onBranch).length;
  assert.ok(seen > 0);
});

test('попутная быстрее тебя не авария — объедет; сам въехал в неё или во встречную — авария', () => {
  const lane = Math.floor(maze.lanes / 2); // полоса, по которой едет стоящая на старте машина
  const standStill = (car, gas = 0) => {
    const track = { ...maze, traffic: { level: 'all', cars: [car] } };
    const me = new Car(track); // без мозга: кнопки жмём сами
    me.controls.gas = gas;
    while (!me.done) me.step(track);
    return me;
  };
  const behind = standStill({ s0: maze.startS - 200, lane, v: 2.3 });
  assert.equal(behind.status, 'stalled', 'попутная проехала насквозь, машина просто заглохла');
  const ahead = standStill({ s0: maze.startS + 200, lane, v: -1.6 });
  assert.equal(ahead.status, 'crashed');
  assert.equal(ahead.crashedInto, 'car');
  const slowAhead = standStill({ s0: maze.startS + 200, lane, v: 0 });
  assert.equal(slowAhead.status, 'stalled', 'стоящая впереди попутная — не авария, пока в неё не въехал');
  const rearEnd = standStill({ s0: maze.startS + 200, lane, v: 1.1 }, 1);
  assert.equal(rearEnd.crashedInto, 'car', 'догнал медленную попутную — сам виноват');
});
