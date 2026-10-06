// Контрольный заезд (#24): честная мерка «новый вариант мозга лучше прежнего или хуже».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getTrainingTrack } from '../../engine/world/track.ts';
import { withTraffic } from '../../engine/world/traffic.ts';
import { controlRun, verdict, controlText } from '../../engine/course/control.ts';
import { BOTS, driverOf } from '../helpers.mjs';

const TRACKS = [withTraffic(getTrainingTrack('warmup'), 'all'), withTraffic(getTrainingTrack('snake'), 'all')];

test('контрольный заезд детерминирован: два прогона — один результат', () => {
  for (const file of BOTS) {
    assert.deepEqual(controlRun(TRACKS, driverOf(file)), controlRun(TRACKS, driverOf(file)), file.name);
  }
});

test('вердикт: сам с собой — «так же», с тем, кто хуже, — «лучше», и наоборот', () => {
  const results = BOTS.map((file) => controlRun(TRACKS, driverOf(file))).sort((a, b) => a.score - b.score);
  const [best, worst] = [results[0], results.at(-1)];
  assert.ok(best.score < worst.score, 'боты едут по-разному');
  assert.equal(verdict(best, best).mark, 'same');
  assert.equal(verdict(best, worst).mark, 'better');
  assert.equal(verdict(worst, best).mark, 'worse');
  assert.ok(verdict(best, worst).text.length > 0);
});

test('кто не доехал, объясняем словами: круг, на котором разбился', () => {
  const stands = { brain: null, think: () => [0, 0, 0, 0], sensors: undefined };
  const still = controlRun(TRACKS, stands);
  assert.ok(still.legs.every((leg) => leg.seconds === null && leg.lap === 1), 'стоя на месте, никуда не доедешь');
  assert.match(controlText(still), /^проехал \d+%$/);
  const good = BOTS.map((file) => controlRun(TRACKS, driverOf(file))).find((r) => r.legs.every((leg) => leg.seconds !== null));
  assert.ok(good, 'хотя бы один бот доезжает обе трассы');
  assert.match(controlText(good), /^\d+,\d с$/);
  const v = verdict(still, good);
  assert.equal(v.mark, 'worse');
  assert.match(v.text, /не успел доехать|разбился/);
});
