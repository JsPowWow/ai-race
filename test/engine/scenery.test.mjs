// Декор вокруг трассы: из seed, всегда за бордюрами, у знака пусто (ADR 0005).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sceneryOf, stripScenery, segmentDistance, signSpots, houseRadius, SCENERY_GAP, SIGN_CLEAR } from '../../engine/scenery.ts';
import { getTrainingTrack, generateTrack, buildTrack, TRAINING_TRACKS } from '../../engine/track.ts';
import { drawRing } from '../../engine/turtle.ts';

const tracks = [...TRAINING_TRACKS.map((t) => getTrainingTrack(t.id)), generateTrack('витрина'), generateTrack('финал-2026')];

/** Все предметы декора кругами: дерево — крона, домик — круг, в который он влезает */
const items = (s) => [...s.trees, ...s.houses.map((h) => ({ x: h.x, y: h.y, r: houseRadius(h) }))];

/** Честное расстояние до ближайшей центральной линии — перебором всех отрезков всех дорог */
function nearestRoad(track, x, y) {
  let best = Infinity;
  for (const road of track.roads) {
    const c = road.center;
    for (let i = 0; i < c.length - 1; i++) best = Math.min(best, segmentDistance(x, y, c[i].x, c[i].y, c[i + 1].x, c[i + 1].y));
  }
  return best;
}

test('одна трасса — один и тот же лес, даже если трассу построили заново', () => {
  const program = TRAINING_TRACKS[1];
  const again = buildTrack({ ...program, ...drawRing(program.program) }); // другой объект — та же трасса
  assert.deepEqual(sceneryOf(again), sceneryOf(getTrainingTrack(program.id)));
  assert.notDeepEqual(sceneryOf(getTrainingTrack('warmup')).trees, sceneryOf(getTrainingTrack('snake')).trees, 'у разных трасс лес разный');
});

test('декор стоит за бордюрами: на дорогу и к самой обочине не заходит', () => {
  for (const track of tracks) {
    for (const o of items(sceneryOf(track))) {
      const gap = nearestRoad(track, o.x, o.y) - track.width / 2 - o.r;
      assert.ok(gap >= SCENERY_GAP - 0.01, `${track.id}: предмет в (${o.x | 0}, ${o.y | 0}) в ${gap.toFixed(1)} px от края дороги`);
    }
  }
});

test('у знака пусто: его видно издалека', () => {
  for (const track of tracks.filter((t) => t.islands.length)) {
    for (const sign of signSpots(track)) {
      for (const o of items(sceneryOf(track))) assert.ok(Math.hypot(o.x - sign.x, o.y - sign.y) >= SIGN_CLEAR + o.r, `${track.id}: декор у знака`);
    }
  }
});

test('домики не налезают на деревья и друг на друга', () => {
  for (const track of tracks) {
    const { trees, houses } = sceneryOf(track);
    for (const [i, h] of houses.entries()) {
      for (const o of [...houses.slice(i + 1).map((g) => ({ x: g.x, y: g.y, r: houseRadius(g) })), ...trees]) {
        assert.ok(Math.hypot(o.x - h.x, o.y - h.y) >= houseRadius(h) + o.r * 0.85 - 0.01, `${track.id}: домик в (${h.x | 0}, ${h.y | 0}) налез на соседа`);
      }
    }
  }
});

test('декора в меру: лес вокруг, но не стена', () => {
  for (const track of tracks) {
    const { trees, houses } = sceneryOf(track);
    assert.ok(trees.length > 100 && trees.length < 600, `${track.id}: деревьев ${trees.length}`);
    assert.ok(houses.length >= 3 && houses.length < 40, `${track.id}: домиков ${houses.length}`);
    assert.ok(trees.some((t) => t.kind === 'fir') && trees.some((t) => t.kind === 'round'), `${track.id}: и ёлки, и круглые деревья`);
  }
});

test('лес у стенда повторяется без шва: на стыке деревья не налезают, к дороге не подходят', () => {
  const period = 2400, width = 168;
  const { trees, houses } = stripScenery(period, width);
  assert.deepEqual(stripScenery(period, width), { trees, houses }, 'каждый раз тот же лес');
  const all = [...trees.map((t) => ({ ...t, k: 0.85 })), ...houses.map((h) => ({ x: h.x, y: h.y, r: houseRadius(h), k: 1 }))];
  assert.ok(trees.length > 60, `деревьев ${trees.length}`);
  for (const o of all) assert.ok(Math.abs(o.y) - width / 2 - o.r >= SCENERY_GAP - 0.01, `предмет в (${o.x | 0}, ${o.y | 0}) у самой дороги`);
  // копия леса сдвинута на period: как его видно на стыке
  for (const a of all) for (const b of all) {
    const dx = Math.abs(a.x - b.x - period), d = Math.hypot(dx, a.y - b.y);
    assert.ok(d >= Math.min(a.r * a.k + b.r, a.r + b.r * b.k) - 0.01, `на стыке налезли (${a.x | 0}, ${a.y | 0}) и (${b.x | 0}, ${b.y | 0})`);
  }
});
