// Новая пара ключей курса.
//   node tools/course-keys.mjs [куда положить секретный ключ=../ai-race-private-key.json]
// Открытый ключ пишется в course-key.json (его коммитят), секретный — рядом с репозиторием, НЕ внутри.
// То же самое умеет кнопка «Создать ключи курса» на вкладке «Финал».
import { writeFileSync, existsSync } from 'fs';
import { generateCourseKeys } from '../engine/seal.ts';

const privatePath = process.argv[2] ?? '../ai-race-private-key.json';
if (existsSync(privatePath)) {
  console.error(`${privatePath} уже есть — не перезаписываю. Старые работы открываются только старым ключом.`);
  process.exit(1);
}
const { publicFile, privateFile } = await generateCourseKeys();
writeFileSync('course-key.json', `${JSON.stringify(publicFile, null, 2)}\n`);
writeFileSync(privatePath, `${JSON.stringify(privateFile, null, 2)}\n`);
console.log(`Ключ курса ${publicFile.kid}\n  открытый → course-key.json (закоммитьте и пересоберите: npm run build)\n  секретный → ${privatePath} (храните у кураторов, не публикуйте)`);
