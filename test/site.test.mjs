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

test('«Я учу»: заезд с другими глазами виден, обучение честно говорит про «Плавный» и сажает мозг за руль', async () => {
  const { page, problems, close } = await openPage(SCREENS[0]);
  await page.goto(`${base}app/icon.svg`); // тот же сайт без приложения: кладём машину «как до гаража» — гараж её заберёт
  await page.evaluate(() => {
    const sample = (inputs) => String.fromCharCode(0x101) + String.fromCharCode(0x100 + 100).repeat(inputs); // газ, все входы 0
    const run = (id, inputs, count) => ({ id, at: '2026-09-01T10:00:00Z', trackName: 'Разминка', traffic: 'none', status: 'finished', progressPct: 100, ticks: count, inputs, packed: Array(count).fill(sample(inputs)), on: true });
    localStorage.setItem('ai-race:config', JSON.stringify({ sensors: { count: 5, spread: 90, length: 160 }, hidden: [6], think: 'step' }));
    // 5 сенсоров → 15 входов; второй заезд записан с 7 сенсорами (19 входов) — на нём учить нельзя
    localStorage.setItem('ai-race:runs', JSON.stringify([run('fits', 15, 250), run('other', 19, 40)]));
  });
  await page.goto(`${base}#teach`);
  await page.waitForFunction(() => document.body.dataset.tab === 'teach' && document.querySelectorAll('#runsList li').length === 2);
  const other = page.locator('#runsList li', { hasText: '40 прим.' });
  assert.match(await other.textContent(), /7 сенсорами.*сейчас их 5.*не учим/);
  assert.ok(await other.locator('input').isDisabled(), 'галочку у чужого заезда не поставить');
  assert.ok(!(await other.locator('input').isChecked()), 'и она не стоит: на нём не учим');
  assert.match(await page.textContent('#runsOthers'), /1 заезд записан с другими глазами/);
  assert.match(await page.textContent('#teachStatus'), /^1 заезд, 250 примеров/);
  assert.match(await page.textContent('#teachThink'), /с «Ступенька» на «Плавный»/, 'заранее говорим, что вариант мозга сменится');

  await page.click('#teachGo');
  await page.waitForFunction(() => document.querySelector('#dBrain').getAttribute('aria-pressed') === 'true', null, { timeout: 10000 });
  assert.match(await page.textContent('#banner'), /думает теперь «Плавный»/);
  assert.ok(await page.isHidden('#teachThink'), 'мозг уже плавный — предупреждать не о чем');
  assert.match(await page.textContent('#lrSummary'), /^Эпоха 20 · ошибка/);
  assert.match(await page.textContent('#champChip'), /обучен на 1 заезде/);

  // «Мозг под микроскопом»: щёлкаем по схеме, пока не попадём в нейрон или связь, и правим вес руками
  await page.locator('#netCanvas').scrollIntoViewIfNeeded();
  const box = await page.locator('#netCanvas').boundingBox();
  for (let x = box.width - 60; x > 0 && await page.isHidden('#wRow'); x -= 4) {
    for (let y = 8; y < box.height && await page.isHidden('#wRow'); y += 8) await page.mouse.click(box.x + x, box.y + y);
  }
  assert.ok(await page.isVisible('#wExplain'), 'выбранный вес объяснён словами');
  await page.fill('#wVal', '-0.5');
  assert.equal(await page.textContent('#wValOut'), '-0.50');
  assert.match(await page.textContent('#netNote'), /поправлен руками/);
  assert.match(await page.textContent('.library .history summary'), /История · 1/, 'обученный мозг до правки — в «Истории»');
  await close();
  assert.deepEqual(problems, []);
});

test('«Учится само»: рой идёт, панель и кнопки следят за ним', async () => {
  const { page, problems, close } = await openPage(SCREENS[0]);
  await page.goto(`${base}#train`);
  await page.waitForFunction(() => document.body.dataset.tab === 'train');
  assert.equal(await page.textContent('#tToggle'), 'Старт');
  assert.ok(await page.isDisabled('#tEndGen'), 'пока роя нет, заканчивать нечего');
  await page.click('.toolbar[data-for="train"] button:has-text("Турбо")');
  assert.equal(await page.getAttribute('.toolbar[data-for="train"] button:has-text("Турбо")', 'aria-pressed'), 'true');
  await page.click('#tToggle');
  assert.equal(await page.textContent('#tToggle'), 'Пауза');
  await page.waitForFunction(() => document.querySelector('#stFin').textContent !== '—', null, { timeout: 20000 });
  await page.click('#tToggle');
  assert.equal(await page.textContent('#tToggle'), 'Продолжить');
  assert.match(await page.textContent('#swarmSay'), /Пауза/);
  assert.match(await page.textContent('#stFin'), /^\d+ из 100$/);

  // рекорд роя можно взять в текущий мозг
  await page.click('#hall button:has-text("Взять")');
  assert.match(await page.textContent('#banner'), /рекорд поколения/);

  // трасса по seed: появляется поле для seed
  assert.ok(await page.isHidden('#tSeedRow'));
  await page.selectOption('#tTrack', 'seed');
  assert.ok(await page.isVisible('#tSeedRow'));

  // «Сбросить мозг» — рой начинается заново
  await page.click('#trainPanel .library button:has-text("Сбросить мозг")');
  await page.click('#trainPanel .library button:has-text("Сбросить")');
  assert.equal(await page.textContent('#tToggle'), 'Старт');
  assert.equal(await page.textContent('#stFin'), '—');
  assert.match(await page.textContent('#hall'), /Здесь появятся рекорды/);
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

test('табло мозга: наведи на нейрон — формула в столбик; масштаб — кнопками', async () => {
  const { page, problems, close } = await openPage(SCREENS[0]);
  await page.goto(`${base}#intro`);
  const canvas = page.locator('#brainBoard');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  // скрытый слой — посередине табло: ведём указатель вниз по середине, пока не попадём в нейрон
  let shown = false;
  for (let y = 0.2; y < 0.8 && !shown; y += 0.02) {
    await page.mouse.move(box.x + box.width * 0.47, box.y + box.height * y);
    shown = await page.waitForFunction(() => !document.querySelector('#brainFormula').hidden, null, { timeout: 150 }).then(() => true, () => false);
  }
  assert.ok(shown, 'формула появилась');
  assert.match(await page.textContent('#brainFormula'), /^Нейрон \d+.*сумма .* − порог .*tanh\(2 × /s);
  await page.mouse.move(box.x + box.width / 2, box.y - 20); // увели указатель с табло — формула прячется
  await page.waitForFunction(() => document.querySelector('#brainFormula').hidden);

  const zoom = (z) => page.locator(`.brain-board:has(#brainBoard) [data-z="${z}"]`);
  assert.equal(await zoom('out').isDisabled(), true, 'отдалять дальше обычного некуда');
  assert.equal(await zoom('reset').isHidden(), true);
  await zoom('in').click();
  assert.equal(await zoom('out').isDisabled(), false);
  assert.equal(await zoom('reset').isVisible(), true, 'приблизили — есть «1:1»');
  for (let n = 0; n < 3; n++) await zoom('in').click(); // 1.5 → 2.25 → 3.4 → 4
  assert.equal(await zoom('in').isDisabled(), true, 'дальше предела не приблизить');
  await zoom('reset').click();
  assert.equal(await zoom('reset').isHidden(), true);
  assert.equal(await zoom('out').isDisabled(), true);
  await close();
  assert.deepEqual(problems, []);
});
