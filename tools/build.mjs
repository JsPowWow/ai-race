// Сборка сайта.
//
//   npm run build        — один раз
//   npm run dev          — пересобирать при каждом сохранении (и смотреть через npm start)
//
// Что получается:
//   app/generated/*.js   — данные для кода: исходники student/*.js, боты, открытый ключ курса, код Worker финала;
//   app/generated/app.js — весь код сайта одним файлом (+ chunks/ — то, что грузится позже, например финал);
//   app/generated/app.css — стили вместе со шрифтами;
//   index.html           — страница, которую раздаёт GitHub Pages;
//   dist/ai-race.html    — всё в одном файле: можно открыть без интернета и без сервера.
//
// Исходники остаются обычными ES-модулями: сборка нужна, чтобы браузер скачал один файл, а не полсотни.
import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import * as esbuild from 'esbuild';

const r = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const w = (p, s) => writeFileSync(new URL(`../${p}`, import.meta.url), s);
const watch = process.argv.includes('--watch');

const TITLE = 'AI Race — научи машину ездить без водителя';
const DESCRIPTION = 'Курс JavaScript: машинка с лучами-сенсорами и маленькой нейросетью учится ездить — на твоих примерах и сама, эволюцией. В конце — гонка на секретной трассе.';
/** Цвет шапки браузера на телефоне — фон страницы в светлой и тёмной теме (как --bg в app/styles/tokens.css) */
const THEME_COLOR = { light: '#eef0f3', dark: '#0b0d12' };
/** Шрифты первого экрана: заголовок и основной текст — качаем сразу, не дожидаясь CSS */
const PRELOAD_FONTS = ['unbounded-cyrillic', 'golos-text-cyrillic'];

function writeDataModules() {
  const SOURCES = Object.fromEntries(['controls', 'think', 'mutate', 'fitness', 'crossover'].map((id) => [id, r(`student/${id}.js`)]));
  w('app/generated/sources.js', `// Сгенерировано tools/build.mjs: исходники student/*.js для вкладки «Код».\nexport const SOURCES = ${JSON.stringify(SOURCES, null, 1)};\n`);
  // Открытый ключ курса: им «Экзамен» запечатывает файл для сдачи (секретный ключ есть только у кураторов)
  const courseKey = existsSync(new URL('../course-key.json', import.meta.url)) ? r('course-key.json').trim() : 'null';
  w('app/generated/course-key.js', `// Сгенерировано tools/build.mjs из course-key.json: открытый ключ курса.\nexport const COURSE_KEY = ${courseKey};\n`);
  w('app/generated/bots.js', `// Сгенерировано из tools/bots.json (tools/train-bots.mjs): боты-соперники для гонки.\nexport const BOTS = ${r('tools/bots.json')};\n`);
}

// Web Worker финала собираем в строку: так он работает и на GitHub Pages, и в однофайловой сборке
async function writeWorker() {
  const worker = await esbuild.build({ entryPoints: ['app/final/worker.js'], bundle: true, format: 'iife', minify: true, write: false, target: 'es2020', legalComments: 'none' });
  w('app/generated/race-worker.js', `// Сгенерировано tools/build.mjs из app/final/worker.js: код Web Worker для расчёта финала.\nexport const WORKER_SOURCE = ${JSON.stringify(worker.outputFiles[0].text)};\n`);
}

const common = { bundle: true, minify: true, target: 'es2022', legalComments: 'none', logLevel: 'warning' };

/** Сайт: модули с отложенной загрузкой, карта исходников (в DevTools видны настоящие файлы) */
const siteOptions = {
  ...common,
  entryPoints: [{ in: 'app/main.js', out: 'app' }, { in: 'app/styles.css', out: 'app' }],
  outdir: 'app/generated',
  entryNames: '[name]',
  chunkNames: 'chunks/[name]-[hash]',
  format: 'esm',
  splitting: true,
  sourcemap: 'linked',
  sourcesContent: false, // исходники и так лежат рядом, в репозитории
  external: ['*.woff2'], // шрифты остаются в app/fonts: путь ../fonts/… верен и из исходника, и из сборки
  metafile: true,
};

/** Общая шапка страницы; links — ссылки на файлы (иконка, шрифты, стили) */
function pageHead(links) {
  return `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${TITLE}</title>
<meta name="description" content="${DESCRIPTION}">
<meta name="theme-color" content="${THEME_COLOR.light}" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="${THEME_COLOR.dark}" media="(prefers-color-scheme: dark)">
<meta property="og:title" content="${TITLE}">
<meta property="og:description" content="${DESCRIPTION}">
<meta property="og:type" content="website">
${links.join('\n')}`;
}

const page = (head, body) => `<!doctype html>
<html lang="ru">
<head>
${head}
</head>
<body>
${body}
</body>
</html>
`;

/** Куски кода, которые app.js импортирует сразу: браузер начнёт качать их вместе с ним */
const eagerChunks = (metafile) => metafile.outputs['app/generated/app.js'].imports.filter((i) => i.kind === 'import-statement').map((i) => i.path);

/**
 * Применить сохранённую тему до первой отрисовки — иначе при светлой теме страница на миг мигнёт тёмной.
 * Ключ — как в app/storage.js (префикс ai-race:), значения — как в app/theme.js.
 */
const THEME_SCRIPT = `<script>try{const t=JSON.parse(localStorage.getItem('ai-race:theme'));if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch{}</script>`;

function writeIndex(metafile) {
  const preload = [
    ...PRELOAD_FONTS.map((f) => `<link rel="preload" href="app/fonts/${f}.woff2" as="font" type="font/woff2" crossorigin>`),
    ...eagerChunks(metafile).map((path) => `<link rel="modulepreload" href="${path}">`),
  ];
  w('index.html', page(pageHead([
    THEME_SCRIPT,
    '<link rel="icon" href="app/icon.svg" type="image/svg+xml">',
    ...preload,
    '<link rel="stylesheet" href="app/generated/app.css">',
    '<script type="module" src="app/generated/app.js"></script>',
  ]), r('app/markup.html')));
}

/** Один файл без сервера: скрипт — iife (финал подгружается из того же файла), шрифты и иконка — внутри */
async function writeSingleFile() {
  const [js, css] = await Promise.all([
    esbuild.build({ ...common, entryPoints: ['app/main.js'], format: 'iife', write: false }),
    esbuild.build({ ...common, entryPoints: ['app/styles.css'], loader: { '.woff2': 'dataurl' }, write: false }),
  ]);
  const script = js.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
  const icon = `data:image/svg+xml,${encodeURIComponent(r('app/icon.svg'))}`;
  mkdirSync(new URL('../dist', import.meta.url), { recursive: true });
  w('dist/ai-race.html', page(pageHead([
    THEME_SCRIPT,
    `<link rel="icon" href="${icon}">`,
    `<style>\n${css.outputFiles[0].text}</style>`,
  ]), `${r('app/markup.html')}\n<script>\n${script}</script>`));
  return script.length;
}

async function buildAll() {
  writeDataModules();
  await writeWorker();
  rmSync(new URL('../app/generated/chunks', import.meta.url), { recursive: true, force: true });
  const { metafile } = await esbuild.build(siteOptions);
  writeIndex(metafile);
  const size = await writeSingleFile();
  console.log('ok', `${(size / 1024).toFixed(0)} KB js`);
}

if (!watch) {
  await buildAll();
} else {
  // Пересобираем всё целиком: это меньше секунды, зато никаких «забыл пересобрать»
  const { watch: watchFiles } = await import('fs');
  await buildAll();
  let timer = 0;
  for (const dir of ['app', 'engine', 'student', 'tools']) {
    watchFiles(new URL(`../${dir}`, import.meta.url), { recursive: true }, (_event, file) => {
      if (!file || file.startsWith('generated') || (dir === 'tools' && !file.endsWith('.json'))) return;
      clearTimeout(timer);
      timer = setTimeout(() => buildAll().catch((e) => console.error(e.message)), 100);
    });
  }
  console.log('Слежу за файлами. Открой сайт: npm start');
}
