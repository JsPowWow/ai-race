// Звук мотора: какой тон у мотора и как слышно чужую машину.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toneOf, heard, HEAR } from '../../engine/sound-mix.ts';
import { CAR } from '../../engine/car.ts';

test('мотор: быстрее — выше, газ — громче и ярче, на месте — тихий холостой ход', () => {
  const idle = toneOf(0, 0), cruise = toneOf(CAR.maxSpeed, 0), push = toneOf(CAR.maxSpeed, 1);
  assert.ok(idle.freq < cruise.freq, 'на скорости тон выше');
  assert.ok(push.gain > cruise.gain && push.cutoff > cruise.cutoff, 'жмёшь газ — громче и ярче');
  assert.ok(idle.gain > 0, 'стоишь — мотор всё равно урчит');
  assert.equal(toneOf(-CAR.maxSpeed, 0).freq, cruise.freq, 'назад — тот же мотор');
});

test('чужая машина: ближе — громче, справа по ходу — в правом ухе, далеко — не слышно', () => {
  const me = { x: 0, y: 0, angle: 0 }; // едем вправо по трассе: справа по ходу — y больше
  const near = heard(me, { x: 40, y: 0 }), far = heard(me, { x: 300, y: 0 });
  assert.ok(near.gain > far.gain);
  assert.ok(Math.abs(near.pan) < 0.01, 'прямо впереди — посередине');
  assert.ok(heard(me, { x: 0, y: 60 }).pan > 0.5, 'справа — правее');
  assert.ok(heard(me, { x: 0, y: -60 }).pan < -0.5, 'слева — левее');
  assert.equal(heard(me, { x: HEAR.range + 1, y: 0 }).gain, 0);
});
