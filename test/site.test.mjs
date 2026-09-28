// Сайт в настоящем браузере: каждая вкладка открывается без ошибок и без горизонтальной прокрутки —
// на десктопе и на телефоне. Нужен собранный сайт (npm run build) и Chromium для Playwright
// (локально — один раз: npx playwright install chromium).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'http';
import { readFile } from 'fs/promises';
import { extname, join, normalize } from 'path';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.map': 'application/json' };
const TABS = ['intro', 'profile', 'teach', 'train', 'code', 'exam', 'race', 'final'];
const SCREENS = [
  { name: 'десктоп 1440', viewport: { width: 1440, height: 900 } },
  { name: 'телефон 390', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
];

/** Простой статический сервер — как GitHub Pages, только локально */
const server = createServer(async (req, res) => {
  const url = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  const file = url.endsWith('/') ? `${url}index.html` : url;
  try {
    const body = await readFile(join(ROOT, file));
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
});

let browser;
let base;
before(async () => {
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  server.close();
});

/** Открыть страницу и собрать всё плохое: ошибки скрипта, ошибки в консоли, 404 */
async function openPage(screen) {
  const context = await browser.newContext(screen);
  const page = await context.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`ошибка: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && problems.push(`консоль: ${m.text()}`));
  page.on('response', (r) => r.status() >= 400 && problems.push(`${r.status()}: ${r.url()}`));
  return { page, problems, close: () => context.close() };
}

for (const screen of SCREENS) {
  test(`${screen.name}: все вкладки открываются чисто`, async () => {
    const { page, problems, close } = await openPage(screen);
    for (const tab of TABS) {
      await page.goto(`${base}#${tab}`);
      await page.waitForFunction((id) => document.body.dataset.tab === id, tab);
      await page.waitForTimeout(300); // пара кадров отрисовки
      const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
      assert.ok(scroll <= width, `${tab}: горизонтальная прокрутка (${scroll} > ${width})`);
    }
    await close();
    assert.deepEqual(problems, []);
  });
}

test('«Я учу»: машина ждёт на старте, пока не нажмёшь газ, — не глохнет', async () => {
  const { page, problems, close } = await openPage(SCREENS[0]);
  await page.goto(`${base}#teach`);
  await page.waitForFunction(() => document.body.dataset.tab === 'teach');
  await page.waitForTimeout(3600); // дольше, чем машина стоит до «заглох» (CAR.stallTicks = 3 с)
  const banner = await page.evaluate(() => { const b = document.querySelector('#banner'); return b && !b.hidden ? b.textContent : ''; });
  assert.doesNotMatch(banner, /Заглох/);
  await close();
  assert.deepEqual(problems, []);
});

test('финал не грузится, пока его не открыли', async () => {
  const { page, close } = await openPage(SCREENS[0]);
  const loaded = [];
  page.on('request', (r) => loaded.push(r.url()));
  await page.goto(`${base}#teach`);
  await page.waitForFunction(() => document.body.dataset.tab === 'teach');
  assert.ok(!loaded.some((url) => url.includes('/chunks/final-')), 'код финала скачался заранее');
  await close();
});

test('переключатель темы: авто → светлая → тёмная, выбор помнится после перезагрузки', async () => {
  const { page, problems, close } = await openPage({ ...SCREENS[0], colorScheme: 'dark' });
  await page.goto(`${base}#intro`);
  const theme = () => page.evaluate(() => document.documentElement.dataset.theme ?? 'system');
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  assert.equal(await theme(), 'system');
  const dark = await background();

  await page.click('#themeToggle');
  assert.equal(await theme(), 'light');
  assert.notEqual(await background(), dark, 'светлая тема меняет фон');

  await page.reload();
  assert.equal(await theme(), 'light', 'после перезагрузки — та же тема');

  await page.click('#themeToggle');
  assert.equal(await theme(), 'dark');
  await page.click('#themeToggle');
  assert.equal(await theme(), 'system');
  await close();
  assert.deepEqual(problems, []);
});

/** Машины гаража прямо из папки сайта (OPFS): [{ name, generation, versions }] */
const garageFiles = (page) => page.evaluate(async () => {
  const cars = await (await navigator.storage.getDirectory()).getDirectoryHandle('cars');
  const list = [];
  for await (const [, dir] of cars.entries()) {
    const read = async (name) => JSON.parse(await (await (await dir.getFileHandle(name)).getFile()).text());
    const car = await read('car.json');
    list.push({ name: car.profile.name, generation: car.generation, versions: (await read('history.json')).length });
  }
  return list;
});

test('гараж: машина из старого localStorage переезжает в папку сайта и помнится после перезагрузки', async () => {
  const { page, problems, close } = await openPage(SCREENS[0]);
  await page.goto(`${base}app/icon.svg`); // тот же сайт, но без приложения: кладём «старые» данные, как до гаража
  await page.evaluate(() => {
    localStorage.setItem('ai-race:profile', JSON.stringify({ name: 'Молния', color: '#3ddc84', login: 'octocat' }));
    localStorage.setItem('ai-race:generation', '7');
  });
  await page.goto(`${base}#profile`);
  await page.waitForFunction(() => document.body.dataset.tab === 'profile');
  assert.equal(await page.inputValue('#pName'), 'Молния');
  assert.deepEqual(await garageFiles(page), [{ name: 'Молния', generation: 7, versions: 0 }]);
  const leftovers = await page.evaluate(() => ['profile', 'generation'].filter((key) => localStorage.getItem(`ai-race:${key}`) !== null));
  assert.deepEqual(leftovers, [], 'старые ключи убраны из localStorage — место свободно');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('ai-race:login'))), 'octocat', 'логин остался общим');

  await page.fill('#pName', 'Молния-2');
  // перезагружаем сразу, не дожидаясь записи: гараж не должен терять последнюю правку
  await page.reload();
  await page.waitForFunction(() => document.body.dataset.tab === 'profile');
  assert.equal(await page.inputValue('#pName'), 'Молния-2');
  assert.deepEqual((await garageFiles(page)).map((c) => c.name), ['Молния-2'], 'и в файле машины — тоже');
  await close();
  assert.deepEqual(problems, []);
});
