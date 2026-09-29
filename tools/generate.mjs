// Сгенерированные модули в app/generated/ — их берут и сборка сайта (tools/build.mjs), и сервер разработки (vite.config.ts).
//
//   sources.js    — исходники student/*.js для вкладки «Код»;
//   course-key.js — открытый ключ курса (им «Экзамен» запечатывает файл для сдачи);
//   bots.js       — боты-соперники из tools/bots.json;
//   race-worker.js, car-writer.js — код Web Worker финала и записи гаража строкой.
//
// Почему обычные JS-модули, а не импорт «?raw» или «?worker» из Vite: их импортирует и код, который Node
// запускает в тестах без сборки (app/student-code.ts), а Worker строкой работает и на GitHub Pages,
// и в однофайловой dist/ai-race.html.
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { build } from 'vite';

const ROOT = new URL('../', import.meta.url);
const r = (p) => readFileSync(new URL(p, ROOT), 'utf8');
/** Записать, только если текст другой: сервер разработки не перезагружает страницу зря */
const w = (p, s) => {
  const url = new URL(p, ROOT);
  if (!existsSync(url) || readFileSync(url, 'utf8') !== s) writeFileSync(url, s);
};

export function writeDataModules() {
  const SOURCES = Object.fromEntries(['controls', 'think', 'mutate', 'fitness', 'crossover'].map((id) => [id, r(`student/${id}.js`)]));
  w('app/generated/sources.js', `// Сгенерировано tools/generate.mjs: исходники student/*.js для вкладки «Код».\nexport const SOURCES = ${JSON.stringify(SOURCES, null, 1)};\n`);
  const courseKey = existsSync(new URL('course-key.json', ROOT)) ? r('course-key.json').trim() : 'null';
  w('app/generated/course-key.js', `// Сгенерировано tools/generate.mjs из course-key.json: открытый ключ курса.\nexport const COURSE_KEY = ${courseKey};\n`);
  w('app/generated/bots.js', `// Сгенерировано tools/generate.mjs из tools/bots.json (tools/train-bots.mjs): боты-соперники для гонки.\nexport const BOTS = ${r('tools/bots.json')};\n`);
}

/** Собрать Worker в одну строку кода (iife: без import, запускается из Blob) */
async function workerSource(entry) {
  const out = await build({
    configFile: false,
    root: ROOT.pathname,
    logLevel: 'warn',
    build: { write: false, minify: true, target: 'es2020', lib: { entry, formats: ['iife'], name: 'worker' }, copyPublicDir: false },
  });
  const [chunk] = (Array.isArray(out) ? out[0] : out).output;
  return chunk.code;
}

export async function writeWorkers() {
  const [race, writer] = await Promise.all([workerSource('app/final/worker.ts'), workerSource('app/car-writer.ts')]);
  w('app/generated/race-worker.js', `// Сгенерировано tools/generate.mjs из app/final/worker.ts: код Web Worker для расчёта финала.\nexport const WORKER_SOURCE = ${JSON.stringify(race)};\n`);
  w('app/generated/car-writer.js', `// Сгенерировано tools/generate.mjs из app/car-writer.ts: Web Worker, который пишет файлы гаража.\nexport const WRITER_SOURCE = ${JSON.stringify(writer)};\n`);
}
