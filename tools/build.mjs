// Сборка сайта на Vite (#15).
//
//   npm run build        — собрать сайт
//   npm run dev          — сервер Vite для разработки: исходники без сборки, страница обновляется при сохранении
//
// Что получается:
//   app/generated/*.js       — данные для кода и Workers строкой (tools/generate.mjs);
//   app/generated/app.js     — код сайта (+ chunks/ — то, что грузится позже, например финал), app.css — стили,
//   app/generated/assets/    — шрифты с меткой версии в имени;
//   index.html               — страница, которую раздаёт GitHub Pages (она в корне репозитория — пишем её сами);
//   dist/ai-race.html        — всё в одном файле: можно открыть без интернета и без сервера.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'fs';
import { createHash } from 'crypto';
import { build } from 'vite';
import { writeDataModules, writeWorkers } from './generate.mjs';

const ROOT = new URL('../', import.meta.url);
const r = (p) => readFileSync(new URL(p, ROOT), 'utf8');
const w = (p, s) => writeFileSync(new URL(p, ROOT), s);
const OUT = 'app/generated';

const TITLE = 'AI Race — научи машину ездить без водителя';
const DESCRIPTION = 'Курс JavaScript: машинка с сенсорами и маленькой нейросетью учится ездить — на твоих примерах и сама, эволюцией. В конце — гонка на секретной трассе.';
/** Цвет шапки браузера на телефоне — фон страницы в светлой и тёмной теме (как --bg в app/styles/tokens.css) */
const THEME_COLOR = { light: '#eef0f3', dark: '#0b0d12' };
/** Шрифты первого экрана: заголовок и основной текст — качаем сразу, не дожидаясь CSS */
const PRELOAD_FONTS = ['rubik-cyrillic'];

/** Общее для обеих сборок: Vite без vite.config.ts (там — только сервер разработки) */
const vite = (options) => build({ configFile: false, root: ROOT.pathname, logLevel: 'warn', ...options, build: { target: 'es2022', copyPublicDir: false, ...options.build } });

/** Сайт: код с отложенной загрузкой, стили, шрифты; карты исходников — в DevTools видны настоящие файлы */
async function buildSite() {
  for (const old of ['chunks', 'assets', 'app.css.map']) rmSync(new URL(`${OUT}/${old}`, ROOT), { recursive: true, force: true });
  const out = await vite({
    base: './', // пути от самого файла: сайт живёт не в корне сервера, а в jspowwow.github.io/ai-race/
    build: {
      outDir: OUT,
      emptyOutDir: false, // рядом лежат данные из tools/generate.mjs
      sourcemap: true,
      modulePreload: { polyfill: false }, // что качать сразу, index.html говорит сам (modulepreload ниже)
      rolldownOptions: {
        input: { app: 'app/main.ts', styles: 'app/styles.css' },
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: 'chunks/[name]-[hash].js',
          assetFileNames: (asset) => (asset.names.some((n) => n.endsWith('.css')) ? 'app.css' : 'assets/[name]-[hash][extname]'),
          sourcemapExcludeSources: true, // исходники и так лежат рядом, в репозитории
        },
      },
    },
  });
  return (Array.isArray(out) ? out[0] : out).output;
}

/** Один файл без сервера: скрипт — iife (финал внутри него же), шрифты и иконка — внутри */
async function buildSingleFile() {
  const [js, css] = await Promise.all([
    // iife — всё в одном скрипте, финал тоже. Vite всё равно оборачивает ленивый импорт финала помощником предзагрузки,
    // а в нём import.meta, которого у iife нет: грузить заранее тут нечего, пустой import.meta ему не мешает
    vite({ build: { write: false, modulePreload: false, rolldownOptions: { input: 'app/main.ts', checks: { emptyImportMeta: false }, output: { format: 'iife' } } } }),
    vite({ build: { write: false, assetsInlineLimit: () => true, rolldownOptions: { input: 'app/styles.css' } } }),
  ]);
  const output = (res) => (Array.isArray(res) ? res[0] : res).output;
  const script = output(js).find((f) => f.type === 'chunk').code.replace(/<\/script/gi, '<\\/script');
  const style = output(css).find((f) => f.type === 'asset' && f.fileName.endsWith('.css')).source;
  return { script, style };
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

/** Общая шапка страницы; links — ссылки на файлы (иконка, шрифты, стили) */
const pageHead = (links) => `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${TITLE}</title>
<meta name="description" content="${DESCRIPTION}">
<meta name="theme-color" content="${THEME_COLOR.light}" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="${THEME_COLOR.dark}" media="(prefers-color-scheme: dark)">
<meta property="og:title" content="${TITLE}">
<meta property="og:description" content="${DESCRIPTION}">
<meta property="og:type" content="website">
${links.join('\n')}`;

/**
 * Применить сохранённую тему до первой отрисовки — иначе при светлой теме страница на миг мигнёт тёмной.
 * Ключ — как в app/storage.ts (префикс ai-race:), значения — как в app/theme.ts.
 */
const THEME_SCRIPT = `<script>try{const t=JSON.parse(localStorage.getItem('ai-race:theme'));if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch{}</script>`;

/**
 * Метка версии в адресе: у app.js и app.css имена постоянные, а Pages разрешает кэшировать их 10 минут.
 * Без метки после выкладки браузер берёт новый index.html со старым скриптом — и новые блоки страницы пустые.
 */
const version = (file) => createHash('sha256').update(readFileSync(new URL(file, ROOT))).digest('hex').slice(0, 10);

function writeIndex(output) {
  const app = output.find((f) => f.type === 'chunk' && f.fileName === 'app.js');
  const fonts = output.filter((f) => f.type === 'asset' && PRELOAD_FONTS.some((name) => f.names.includes(`${name}.woff2`)));
  const preload = [
    ...fonts.map((f) => `<link rel="preload" href="${OUT}/${f.fileName}" as="font" type="font/woff2" crossorigin>`),
    // куски кода, которые app.js импортирует сразу: браузер начнёт качать их вместе с ним
    ...app.imports.map((path) => `<link rel="modulepreload" href="${OUT}/${path}">`),
  ];
  w('index.html', page(pageHead([
    THEME_SCRIPT,
    '<link rel="icon" href="app/icon.svg" type="image/svg+xml">',
    ...preload,
    `<link rel="stylesheet" href="${OUT}/app.css?v=${version(`${OUT}/app.css`)}">`,
    `<script type="module" src="${OUT}/app.js?v=${version(`${OUT}/app.js`)}"></script>`,
  ]), r('app/markup.html')));
}

function writeSingleFile({ script, style }) {
  const icon = `data:image/svg+xml,${encodeURIComponent(r('app/icon.svg'))}`;
  mkdirSync(new URL('dist', ROOT), { recursive: true });
  w('dist/ai-race.html', page(pageHead([THEME_SCRIPT, `<link rel="icon" href="${icon}">`, `<style>\n${style}</style>`]),
    `${r('app/markup.html')}\n<script>\n${script}</script>`));
}

writeDataModules();
await writeWorkers();
const output = await buildSite();
writeIndex(output);
const single = await buildSingleFile();
writeSingleFile(single);
const size = (name) => readFileSync(new URL(`${OUT}/${name}`, ROOT)).length / 1024;
console.log('ok', `app.js ${size('app.js').toFixed(0)} KB, один файл ${(single.script.length / 1024).toFixed(0)} KB js`);
