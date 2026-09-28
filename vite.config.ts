// Сервер для разработки на Vite (#15): npm run dev:vite.
// Браузер грузит исходники (app/main.js, app/styles.css) как есть, без бандла, и страница обновляется при сохранении.
// Сайт для GitHub Pages по-прежнему собирает tools/build.mjs (npm run build) — Vite пока только для разработки.
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

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
<script type="module" src="/app/main.js"></script>
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

export default defineConfig({
  plugins: [devPage()],
});
