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

/** Машины гаража прямо из папки сайта (OPFS): [{ name, generation, versions, runs }] */
const garageFiles = (page) => page.evaluate(async () => {
  const cars = await (await navigator.storage.getDirectory()).getDirectoryHandle('cars');
  const list = [];
  for await (const [, dir] of cars.entries()) {
    const read = async (name) => JSON.parse(await (await (await dir.getFileHandle(name)).getFile()).text());
    const car = await read('car.json');
    list.push({ name: car.profile.name, generation: car.generation, versions: (await read('history.json')).length, runs: (await read('runs.json')).length });
  }
  return list;
});

test('гараж: машина из старого localStorage переезжает в папку сайта и помнится после перезагрузки', async () => {
  const { page, problems, close } = await openPage(SCREENS[0]);
  await page.goto(`${base}app/icon.svg`); // тот же сайт, но без приложения: кладём «старые» данные, как до гаража
  await page.evaluate(() => {
    localStorage.setItem('ai-race:profile', JSON.stringify({ name: 'Молния', color: '#3ddc84', login: 'octocat' }));
    localStorage.setItem('ai-race:generation', '7');
    // заезд, записанный до гаража (для другой формы сети — чтобы вкладка его не распаковывала)
    localStorage.setItem('ai-race:runs', JSON.stringify([{ id: 'r1', at: '2026-09-01T10:00:00Z', trackName: 'Разминка', traffic: 'none', status: 'finished', progressPct: 100, ticks: 900, inputs: 99, packed: ['x'], on: true }]));
  });
  await page.goto(`${base}#profile`);
  await page.waitForFunction(() => document.body.dataset.tab === 'profile');
  assert.equal(await page.inputValue('#pName'), 'Молния');
  assert.deepEqual(await garageFiles(page), [{ name: 'Молния', generation: 7, versions: 0, runs: 1 }], 'и «Мои заезды» — в папке машины');
  const leftovers = await page.evaluate(() => ['profile', 'generation', 'runs'].filter((key) => localStorage.getItem(`ai-race:${key}`) !== null));
  assert.deepEqual(leftovers, [], 'старые ключи убраны из localStorage — место свободно');
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('ai-race:login'))), 'octocat', 'логин остался общим');

  await page.fill('#pName', 'Молния-2');
  // перезагружаем сразу, не дожидаясь записи: гараж не должен терять последнюю правку
  await page.reload();
  await page.waitForFunction(() => document.body.dataset.tab === 'profile');
  assert.equal(await page.inputValue('#pName'), 'Молния-2');
  assert.deepEqual((await garageFiles(page)).map((c) => c.name), ['Молния-2'], 'и в файле машины — тоже');

  // заезды — у каждой машины свои: у новой их нет, вернулись в старую — снова на месте
  const runsOnTeach = async () => {
    await page.click('[data-tab="teach"]');
    await page.waitForFunction(() => document.body.dataset.tab === 'teach');
    return page.$$eval('#runsList li:not(.empty)', (list) => list.length);
  };
  assert.equal(await runsOnTeach(), 1);
  await page.click('[data-tab="profile"]');
  await page.click('#gShelf [data-new]');
  await page.waitForFunction(() => document.querySelectorAll('#gShelf [data-car]').length === 2);
  assert.equal(await runsOnTeach(), 0, 'у новой машины заездов нет');
  await page.click('[data-tab="profile"]');
  await page.click('#gShelf [data-car]:not([aria-pressed="true"])');
  await page.waitForFunction(() => document.querySelector('#pName').value === 'Молния-2');
  assert.equal(await runsOnTeach(), 1, 'вернулись в старую — заезд на месте');
  await close();
  assert.deepEqual(problems, []);
});

test('гараж: новая машина, пересесть обратно, черновик спрашивает, удалить', async () => {
  const { page, problems, close } = await openPage(SCREENS[1]);
  await page.goto(`${base}#profile`);
  await page.waitForSelector('#gShelf [data-car]');
  await page.fill('#pName', 'Первая');
  const tiles = () => page.$$eval('#gShelf [data-car]', (list) => list.map((b) => `${b.querySelector('b').textContent}${b.getAttribute('aria-pressed') === 'true' ? ' *' : ''}`));

  await page.click('#gShelf [data-new]');
  await page.waitForFunction(() => document.querySelectorAll('#gShelf [data-car]').length === 2);
  assert.deepEqual(await tiles(), ['Первая', 'Машина 2 *'], 'новая машина — пустая, и мы сразу в ней');
  assert.equal(await page.inputValue('#pName'), 'Машина 2');

  // черновик сборки: перед тем как пересесть, плитка спрашивает, что с ним делать
  await page.click('#addLayer');
  await page.click('#gShelf [data-car]:not([aria-pressed="true"])');
  await page.waitForSelector('#gShelf .g-ask');
  await page.click('#gShelf [data-ask="stay"]');
  assert.equal(await page.isVisible('#draftBar'), true, '«Остаться» — черновик на месте');
  await page.click('#gShelf [data-car]:not([aria-pressed="true"])');
  await page.click('#gShelf [data-ask="drop"]');
  await page.waitForFunction(() => document.querySelector('#pName').value === 'Первая');
  assert.deepEqual(await tiles(), ['Первая *', 'Машина 2']);
  assert.equal(await page.isVisible('#draftBar'), false);

  await page.click('#gDelete');
  await page.click('#gConfirm [data-ask="yes"]');
  await page.waitForFunction(() => document.querySelectorAll('#gShelf [data-car]').length === 1);
  assert.deepEqual(await tiles(), ['Машина 2 *'], 'удалили выбранную — пересели в соседнюю');
  assert.equal(await page.isDisabled('#gDelete'), true, 'последнюю машину удалить нельзя');
  assert.deepEqual(await garageFiles(page), [{ name: 'Машина 2', generation: 0, versions: 0, runs: 0 }], 'у новой машины заездов нет');
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
  assert.ok(scroll <= width, 'без горизонтальной прокрутки');
  await close();
  assert.deepEqual(problems, []);
});

test('гараж: копия в папке на диске — машины приезжают из папки, правки пишутся туда', async () => {
  const { page, problems, close } = await openPage(SCREENS[0]);
  // Настоящий выбор папки в тесте не нажать — вместо папки на диске даём папку «disk» внутри OPFS
  await page.addInitScript(() => {
    window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle('disk', { create: true });
  });
  await page.goto(`${base}#profile`);
  await page.waitForSelector('#gDisk [data-disk="choose"]');
  // в папке уже лежит машина — например, с другого компьютера
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const [[, mine]] = await Array.fromAsync((await root.getDirectoryHandle('cars')).entries());
    const car = JSON.parse(await (await (await mine.getFileHandle('car.json')).getFile()).text());
    const folder = await (await (await root.getDirectoryHandle('disk', { create: true })).getDirectoryHandle('cars', { create: true })).getDirectoryHandle('old1', { create: true });
    const file = await (await folder.getFileHandle('car.json', { create: true })).createWritable();
    await file.write(JSON.stringify({ ...car, created: 1, profile: { ...car.profile, name: 'С диска' } }));
    await file.close();
  });
  const diskNames = () => page.evaluate(async () => {
    const cars = await (await (await navigator.storage.getDirectory()).getDirectoryHandle('disk')).getDirectoryHandle('cars');
    const names = [];
    for await (const [, dir] of cars.entries()) names.push(JSON.parse(await (await (await dir.getFileHandle('car.json')).getFile()).text()).profile.name);
    return names.sort();
  });

  await page.click('#gDisk [data-disk="choose"]');
  await page.waitForFunction(() => document.querySelectorAll('#gShelf [data-car]').length === 2);
  assert.match(await page.textContent('#gShelf'), /С диска/, 'машина из папки приехала на полку');
  await page.fill('#pName', 'Моя');
  await page.waitForFunction(() => document.querySelector('#gDisk')?.textContent.includes('Копия'));
  await page.waitForTimeout(800); // запись через 300 мс после правки
  assert.deepEqual(await diskNames(), ['Моя', 'С диска'], 'в папке — все машины полки, с последней правкой');

  await page.reload();
  await page.waitForSelector('#gDisk [data-disk="stop"]');
  assert.match(await page.textContent('#gDisk'), /Копия — в папке/, 'после перезагрузки папка помнится');
  await page.click('#gDisk [data-disk="stop"]');
  await page.waitForSelector('#gDisk [data-disk="choose"]');
  await close();
  assert.deepEqual(problems, []);
});

// ── финал ──

const BOTS = JSON.parse(await readFile(join(ROOT, 'tools/bots.json'), 'utf8'));
/** Свой вариант мозга, который пытается испортить for…of всем, кто поедет после него в этом же Worker */
const SABOTEUR = `export const thinkVariants = { mine: { think(inputs, brain) {
  try { Object.getPrototypeOf([][Symbol.iterator]()).next = () => ({ done: true }); } catch { /* заморожено */ }
  return [1, 0, 0, 0];
} } };`;

test('финал: чужой код в Worker не портит заезды следующих участников', async () => {
  const { page, problems, close } = await openPage(SCREENS[0]);
  await page.goto(`${base}#final`);
  await page.waitForFunction(() => document.body.dataset.tab === 'final');
  const results = await page.evaluate(async ({ bot, saboteur }) => {
    const { WORKER_SOURCE } = await import('./app/generated/race-worker.js');
    const url = URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
    const entry = (id, code = null) => ({ id, brain: bot.brain, sensors: bot.sensors, thinkId: bot.think, code });
    /** Прогнать задачи одну за другой в одном Worker */
    const run = (jobs) => new Promise((done, fail) => {
      const worker = new Worker(url);
      const out = [];
      // испорченный Worker может и зависнуть — тогда это тоже провал, а не вечное ожидание
      setTimeout(() => fail(new Error('Worker не ответил за 5 с')), 5000);
      worker.onerror = (e) => fail(new Error(e.message));
      worker.onmessage = ({ data }) => {
        out.push({ status: data.result.status, ticks: data.result.ticks, progress: data.result.progress });
        if (out.length === jobs.length) {
          worker.terminate();
          done(out);
        } else worker.postMessage(jobs[out.length]);
      };
      worker.postMessage(jobs[0]);
    });
    const seed = 'проверка · этап 1';
    const clean = await run([{ jobId: 0, seed, entry: entry('bot') }]);
    const after = await run([{ jobId: 0, seed, entry: entry('vandal', saboteur) }, { jobId: 1, seed, entry: entry('bot') }]);
    return { clean: clean[0], after: after[1] };
  }, { bot: BOTS[0], saboteur: SABOTEUR });
  assert.deepEqual(results.after, results.clean, 'бот едет так же, как в чистом Worker');
  await close();
  assert.deepEqual(problems, []);
});

test('финал: работы → расчёт → этап идёт, таблица и поиск', async () => {
  const { page, problems, close } = await openPage(SCREENS[1]);
  await page.goto(`${base}#final`);
  await page.waitForFunction(() => document.body.dataset.tab === 'final');
  assert.equal(await page.isDisabled('#fCompute'), true, 'без работ считать нечего');
  const names = ['anna', 'boris', 'vera', 'gleb'];
  await page.setInputFiles('#fFiles', names.map((name, i) => ({
    name: `${name}.json`, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(BOTS[i % BOTS.length])),
  })));
  await page.waitForFunction(() => document.querySelector('#fCount').textContent === '4');
  assert.equal(await page.textContent('#fBoardTitle'), 'Участники');
  assert.equal(await page.$$eval('#fBoard li', (list) => list.length), 4);
  assert.match(await page.textContent('#fNotes'), /Одинаковый мозг: групп 1/, 'anna и gleb — один и тот же бот');

  await page.fill('#fSecret', 'проверка');
  await page.click('#fCompute');
  await page.waitForFunction(() => document.querySelector('#fComputeNote').textContent.startsWith('Готово'), null, { timeout: 60000 });
  assert.equal(await page.textContent('#fBoardTitle'), 'Этап 1 · на старте');
  assert.equal(await page.isDisabled('#fStages button:nth-child(2)'), false, 'этапы можно выбирать');

  await page.fill('#fSearch', 'vera');
  assert.equal(await page.textContent('#fBoard .found .kind'), '@vera', 'найденный подсвечен');

  await page.click('#fPlay');
  assert.equal(await page.textContent('#fPlay'), '3… 2… 1…');
  await page.waitForFunction(() => document.querySelector('#fBoardTitle').textContent === 'Этап 1 · live', null, { timeout: 10000 });
  await page.click('#fPlay');
  assert.equal(await page.textContent('#fPlay'), 'Дальше', 'пауза посреди этапа');

  await page.click('#fStages button:nth-child(2)');
  assert.equal(await page.textContent('#fBoardTitle'), 'Общий зачёт после 1 этапа');
  assert.equal(await page.$$eval('#fBoard .pos', (list) => list.length), 4);
  const { scroll, width } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, width: innerWidth }));
  assert.ok(scroll <= width, 'без горизонтальной прокрутки');
  await close();
  assert.deepEqual(problems, []);
});
