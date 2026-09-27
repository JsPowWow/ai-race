// Запечатать файл машины для сдачи — для тех, кто работает с репозиторием локально.
//   node tools/seal.mjs car.json <логин на GitHub>   →   car.sealed.json
// Шифрует открытым ключом курса из course-key.json — так же, как кнопка «Скачать для сдачи» на «Экзамене».
import { readFileSync, writeFileSync } from 'fs';
import { sealCar } from '../engine/seal.js';
import { parseCarFile } from '../engine/car-file.js';

const [input, login] = process.argv.slice(2);
if (!input || !login) {
  console.error('Использование: node tools/seal.mjs car.json <логин на GitHub>');
  process.exit(1);
}
try {
  const car = JSON.parse(readFileSync(input, 'utf8'));
  parseCarFile(car); // сразу скажет, если файл машины битый
  const courseKey = JSON.parse(readFileSync(new URL('../course-key.json', import.meta.url), 'utf8'));
  const output = input.replace(/(\.json)?$/i, '.sealed.json');
  writeFileSync(output, JSON.stringify(await sealCar(car, login, courseKey)));
  console.log(`Готово: ${output} (ключ курса ${courseKey.kid}). Его и сдавайте.`);
} catch (e) {
  console.error(`Не получилось: ${e.message}`);
  process.exit(1);
}
