// Детерминизм — главное обещание движка: один seed и один мозг дают один и тот же заезд
// на любом компьютере. На этом держатся финал («считаем заранее, показываем запись») и перепроверка.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateTrack } from '../../engine/track.js';
import { withTraffic } from '../../engine/traffic.js';
import { driveRecorded, stageTrack } from '../../engine/rally.js';
import { BOTS, driverOf } from '../helpers.mjs';

test('одна фраза — одна и та же трасса', () => {
  const a = generateTrack('урок-1');
  const b = generateTrack('урок-1');
  assert.deepEqual(a.center, b.center);
  assert.notDeepEqual(generateTrack('урок-2').center, a.center);
});

test('один мозг на одной трассе едет одинаково, с трафиком тоже', () => {
  const track = withTraffic(generateTrack('проверка детерминизма'), 'all');
  for (const file of BOTS) {
    const first = driveRecorded(track, driverOf(file));
    const second = driveRecorded(track, driverOf(file));
    assert.equal(second.status, first.status, file.name);
    assert.equal(second.ticks, first.ticks, file.name);
    assert.deepEqual(second.traj, first.traj, `${file.name}: траектория совпадает до точки`);
  }
});

test('этап финала: трасса строится из фразы и номера этапа', () => {
  const a = stageTrack('секрет · этап 1');
  const b = stageTrack('секрет · этап 1');
  assert.deepEqual(a.center, b.center);
  assert.ok(a.traffic, 'на этапах финала есть машины');
});
