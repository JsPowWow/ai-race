// Файлы, которые выбрали или перетащили: читаем все сразу, плохой не мешает хорошим.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eachJsonFile } from '../../app/files.ts';

const file = (name, text) => new File([text], name, { type: 'application/json' });

test('eachJsonFile: хорошие файлы — по порядку, ошибки — по строке с именем файла', async () => {
  const got = [];
  const errors = await eachJsonFile([
    file('a.json', '{"n":1}'),
    file('b.json', '{не json'),
    file('c.json', '{"n":3}'),
    file('d.json', '{"n":-1}'),
  ], (json, name) => {
    if (json.n < 0) throw new Error('такого не бывает');
    got.push(`${name}=${json.n}`);
  });
  assert.deepEqual(got, ['a.json=1', 'c.json=3']);
  assert.equal(errors.length, 2);
  assert.match(errors[0], /^b\.json: Не получилось прочитать JSON/);
  assert.equal(errors[1], 'd.json: такого не бывает');
});

test('eachJsonFile: нет файлов — нет и ошибок', async () => {
  assert.deepEqual(await eachJsonFile([], () => assert.fail('не должен звать')), []);
});
