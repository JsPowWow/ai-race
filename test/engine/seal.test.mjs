// Запечатанная сдача: открыть может только секретный ключ, подмену видно.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCourseKeys, sealCar, importPrivateKey, openSealed } from '../../engine/seal.js';
import { bot } from '../helpers.mjs';

const keys = await generateCourseKeys();
const secret = await importPrivateKey(keys.privateFile);
const car = bot('Торетто');

test('запечатали открытым ключом — открыли секретным', async () => {
  const sealed = await sealCar(car, 'student-1', keys.publicFile);
  const opened = await openSealed(sealed, secret);
  assert.equal(opened.login, 'student-1');
  assert.deepEqual(opened.car, car);
});

test('один файл, запечатанный дважды, выглядит по-разному', async () => {
  const a = await sealCar(car, 'student-1', keys.publicFile);
  const b = await sealCar(car, 'student-1', keys.publicFile);
  assert.notEqual(a.data, b.data);
});

test('изменённый файл не открывается', async () => {
  const sealed = await sealCar(car, 'student-1', keys.publicFile);
  const tampered = { ...sealed, data: sealed.data.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')) };
  await assert.rejects(openSealed(tampered, secret), /повреждён или изменён/);
});

test('чужой ключ курса — понятная ошибка', async () => {
  const other = await generateCourseKeys();
  const sealed = await sealCar(car, 'student-1', other.publicFile);
  await assert.rejects(openSealed(sealed, secret), /другим ключом курса/);
});

test('неправильный логин GitHub не запечатать', async () => {
  await assert.rejects(sealCar(car, 'не логин', keys.publicFile), /логин/);
});
