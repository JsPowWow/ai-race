// Сервер для разработки на Vite (#15): npm run dev.
// Браузер грузит исходники (app/main.ts, app/styles.css) как есть, без бандла, и страница обновляется при сохранении.
// Сайт для GitHub Pages собирает tools/build.mjs (npm run build) — тоже Vite, но с настройками там.
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
// @ts-expect-error — обычный JS-модуль из tools/, без описаний типов
import { writeDataModules, writeWorkers } from './tools/generate.mjs';

/** Страница для разработки: та же разметка, что у сайта (app/markup.html), но вместо бандла — исходники */
function devPage(): Plugin {
  return {
    name: 'ai-race-dev-page',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split('?')[0];
        if (path !== '/' && path !== '/index.html') return next(); // index.html в корне — для Pages, он грузит бандл
        const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>AI Race — разработка</title>
<link rel="icon" href="/app/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/app/styles.css">
<script type="module" src="/app/main.ts"></script>
</head>
<body>
${readFileSync('app/markup.html', 'utf8')}
</body>
</html>
`;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(await server.transformIndexHtml(req.url ?? '/', html));
      });
    },
  };
}

/**
 * app/generated/*.js (исходники student/, боты, ключ, Workers строкой) — свежие с первой минуты:
 * пишем их при старте и заново, когда поменялось то, из чего они сделаны
 */
function generated(): Plugin {
  const sources = /\/(student|engine)\/|\/tools\/bots\.json$|\/course-key\.json$|\/app\/(final\/worker|car-writer)\.ts$/;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const regenerate = () => Promise.all([writeDataModules(), writeWorkers()]).catch((e: Error) => console.error(e.message));
  return {
    name: 'ai-race-generated',
    async configureServer(server) {
      await regenerate();
      server.watcher.add(['tools/bots.json', 'course-key.json']);
      server.watcher.on('change', (file) => {
        if (!sources.test(file)) return;
        clearTimeout(timer);
        timer = setTimeout(regenerate, 100);
      });
    },
  };
}

export default defineConfig({
  plugins: [devPage(), generated()],
});
