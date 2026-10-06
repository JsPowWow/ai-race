// Следы шин на асфальте: из seed трассы, в размер машинки, у поворотов и у старта.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { skidsOf, GAUGE } from '../../engine/world/skids.ts';
import { cornersOf, segmentDistance } from '../../engine/world/scenery.ts';
import { getTrainingTrack, generateTrack, buildTrack, pointAt, TRAINING_TRACKS } from '../../engine/world/track.ts';
import { CAR } from '../../engine/world/car.ts';
import { drawRing } from '../../engine/world/turtle.ts';

const tracks = [...TRAINING_TRACKS.map((t) => getTrainingTrack(t.id)), generateTrack('витрина'), generateTrack('финал-2026')];

/** Расстояние до центральной линии кольца — перебором всех отрезков */
function fromCenter(track, { x, y }) {
  const c = track.roads[0].center;
  let best = Infinity;
  for (let i = 0; i < c.length - 1; i++) best = Math.min(best, segmentDistance(x, y, c[i].x, c[i].y, c[i + 1].x, c[i + 1].y));
  return best;
}

const lengthOf = (pts) => pts.slice(1).reduce((sum, q, i) => sum + Math.hypot(q.x - pts[i].x, q.y - pts[i].y), 0);

test('одна трасса — одни и те же следы, даже если трассу построили заново', () => {
  const program = TRAINING_TRACKS[1];
  const again = buildTrack({ ...program, ...drawRing(program.program) });
  assert.deepEqual(skidsOf(again), skidsOf(getTrainingTrack(program.id)));
});

test('следы — на асфальте, в размер машинки: колея уже машины, след — от машины до пяти', () => {
  assert.ok(GAUGE < CAR.width && GAUGE > CAR.width / 2, 'колея между колёсами — уже корпуса');
  for (const track of tracks) {
    for (const skid of skidsOf(track)) {
      const [left, right] = skid.wheels;
      assert.equal(left.length, right.length);
      assert.equal(skid.wear.length, left.length - 1, 'потёртость — у каждого кусочка следа');
      left.forEach((a, i) => assert.ok(Math.abs(Math.hypot(right[i].x - a.x, right[i].y - a.y) - GAUGE) < 1.5, `${track.id}: колея ровная`));
      for (const q of [...left, ...right]) assert.ok(fromCenter(track, q) < track.width / 2 - 8, `${track.id}: след за разметкой края`);
      const len = lengthOf(left);
      assert.ok(len >= CAR.length * 0.6 && len <= CAR.length * 5, `${track.id}: след ${len.toFixed(0)} px`);
      assert.ok(skid.wear.every((w) => w >= 0 && w <= 1));
      assert.ok(skid.wear.some((w) => w === 0) || len < 60, 'длинный след полустёрт: местами его нет');
    }
  }
});

test('следы — там, где тормозят и газуют: у крутых поворотов и у черты старта', () => {
  for (const track of tracks) {
    const skids = skidsOf(track);
    const near = (q, at, r) => Math.hypot(q.x - at.x, q.y - at.y) < r;
    for (const skid of skids) {
      const q = skid.wheels[0][0];
      const byCorner = cornersOf(track.roads[0]).some(({ apex }) => near(q, pointAt(track, apex), 260));
      assert.ok(byCorner || near(q, pointAt(track, 0), 140), `${track.id}: след вдали от поворота и старта`);
    }
    assert.ok(skids.some((s) => s.kind === 'spin' && near(s.wheels[0][0], pointAt(track, 0), 140)), `${track.id}: у старта газовали`);
    if (cornersOf(track.roads[0]).length) assert.ok(skids.some((s) => s.kind === 'brake'), `${track.id}: перед поворотом тормозили`);
  }
});
