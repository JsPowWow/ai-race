// Финал без браузера: папка с работами → участники, итоги → файлы.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'fs';
import { buildEntries } from '../app/final/entries.ts';
import { resultText, toCsv } from '../app/final/export.ts';
import { failedResult } from '../engine/world/rally.ts';

const BOTS = JSON.parse(readFileSync(new URL('../tools/bots.json', import.meta.url), 'utf8'));
const file = (path, car, claimed) => ({ path, text: JSON.stringify(car), ...(claimed === undefined ? {} : { claimed }) });

test('автор — папка без общего начала имён, лишние файлы пропускаем', () => {
  const { entries, skipped, problems } = buildEntries([
    file('works/ai-race-final-anna/car.json', BOTS[0]),
    file('works/ai-race-final-boris/car.json', BOTS[1]),
    file('works/ai-race-final-boris/package.json', { name: 'x' }),
    { path: 'works/readme.md', text: '' },
  ]);
  assert.deepEqual(entries.map((e) => e.author), ['anna', 'boris']);
  assert.equal(skipped, 2);
  assert.deepEqual(problems, []);
});

test('одинаковые файлы — «близнецы», чужая печать — «чужой файл?»', () => {
  const { entries, twins, foreign } = buildEntries([
    file('anna/car.json', BOTS[0]),
    file('boris/car.json', BOTS[0]),
    file('vera/car.sealed.json', BOTS[1], 'anna'), // папка — автор, печать — логин внутри
  ]);
  assert.deepEqual(twins.map((group) => group.map((e) => e.author)), [['anna', 'boris']]);
  assert.equal(entries.find((e) => e.author === 'anna').twins, 2);
  assert.deepEqual(foreign.map((e) => `${e.author}←${e.claimed}`), ['vera←anna']);
});

test('битый файл машины — в замечаниях с путём', () => {
  const { entries, problems } = buildEntries([file('anna/car.json', { ...BOTS[0], sensors: { count: 99 } })]);
  assert.equal(entries.length, 0);
  assert.equal(problems.length, 1);
  assert.match(problems[0].path, /car\.json$/);
});

test('результаты словами и CSV с BOM для Excel', () => {
  assert.equal(resultText(null), '—');
  assert.equal(resultText({ ...failedResult('finished', ''), finishTick: 970 }), '16,17 с');
  assert.equal(resultText({ ...failedResult('crashed', ''), crashedInto: 'car', progress: 0.634 }), 'авария на 63%');
  assert.equal(resultText(failedResult('hung', '')), 'завис');
  const csv = toCsv({ final: [], results: [new Map(), new Map(), new Map(), new Map()] });
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.match(csv, /^.?"place","github"/);
});
