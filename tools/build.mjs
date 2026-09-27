// Сборка: app/sources.js, app/bots.js, index.html (для разработки) и dist/ai-race.html (один файл).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { build } from 'esbuild';
import { transform } from 'esbuild';

const r = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const w = (p, s) => writeFileSync(new URL(`../${p}`, import.meta.url), s);

const SOURCES = Object.fromEntries(['controls', 'think', 'mutate', 'fitness', 'crossover'].map((id) => [id, r(`student/${id}.js`)]));
w('app/generated/sources.js', `// Сгенерировано tools/build.mjs: исходники student/*.js для вкладки «Код».\nexport const SOURCES = ${JSON.stringify(SOURCES, null, 1)};\n`);
// Открытый ключ курса: им «Экзамен» запечатывает файл для сдачи (секретный ключ есть только у кураторов)
const courseKey = existsSync(new URL('../course-key.json', import.meta.url)) ? r('course-key.json').trim() : 'null';
w('app/generated/course-key.js', `// Сгенерировано tools/build.mjs из course-key.json: открытый ключ курса.\nexport const COURSE_KEY = ${courseKey};\n`);
w('app/generated/bots.js', `// Сгенерировано из tools/bots.json (tools/train-bots.mjs): боты-соперники для гонки.\nexport const BOTS = ${r('tools/bots.json')};\n`);

// Парсер acorn: нужен вкладке «Код», чтобы показывать номер строки у синтаксических ошибок
const acorn = await transform(r('node_modules/acorn/dist/acorn.mjs'), { format: 'esm', minify: true, legalComments: 'none' });
mkdirSync(new URL('../app/vendor', import.meta.url), { recursive: true });
w('app/vendor/acorn.js', `// acorn ${JSON.parse(r('node_modules/acorn/package.json')).version} (MIT) — https://github.com/acornjs/acorn\n${acorn.code}`);

// Web Worker финала собираем в строку: так он работает и на GitHub Pages, и в однофайловой сборке
const worker = await build({ entryPoints: ['app/final/worker.js'], bundle: true, format: 'iife', minify: true, write: false, target: 'es2020', legalComments: 'none' });
w('app/generated/race-worker.js', `// Сгенерировано tools/build.mjs из app/final/worker.js: код Web Worker для расчёта финала.\nexport const WORKER_SOURCE = ${JSON.stringify(worker.outputFiles[0].text)};\n`);

const FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600&family=JetBrains+Mono:wght@400;600&family=Unbounded:wght@600;700;800;900&display=swap">';
const markup = r('app/markup.html');
const css = r('app/styles.css');

w('index.html', `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>AI Race</title>
${FONTS}
<link rel="stylesheet" href="app/styles.css">
</head>
<body>
${markup}
<script type="module" src="app/main.js"></script>
</body>
</html>
`);

const out = await build({ entryPoints: ['app/main.js'], bundle: true, format: 'iife', minify: true, write: false, target: 'es2020', legalComments: 'none' });
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
mkdirSync(new URL('../dist', import.meta.url), { recursive: true });
w('dist/ai-race.html', `<title>AI Race</title>
${FONTS}
<style>
${css}
</style>
${markup}
<script>
${js}
</script>
`);
console.log('ok', (js.length / 1024).toFixed(0) + ' KB js');
