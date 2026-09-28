# AI Race

Учебный симулятор для курса JavaScript: машинка с лучами-сенсорами, маленькая нейросеть, обучение на примерах и роем (генетический алгоритм), экзамен, гонка и финал курса на сотни участников. Сайт — https://jspowwow.github.io/ai-race/ (GitHub Pages из ветки `main`, папка `/`).

Подробности для людей — @README.md. Здесь — то, что нужно знать, прежде чем менять код.

## Язык и тон
- Все тексты интерфейса, комментарии, коммиты и ответы — **по-русски**, просто, для начинающих.
- Код должен быть таким, чтобы его не стыдно показать студентам: маленькие модули, понятные имена, комментарий — «зачем», а не «что».

## Раскладка
- `student/` — пять файлов, которые пишут студенты. Намеренно простые.
- `engine/` — мир без DOM (трассы, машина, трафик, сеть, эволюция, обучение на примерах, финал, шифрование). Работает и в Node.
- `app/` — интерфейс: `main.js` (вкладки, кадровый цикл), `state.js` (состояние, события), `garage.js` (гараж: машины, пересесть, файл машины) + `car-store.js`/`car-writer.js` (где лежат: OPFS через Worker или `localStorage`), `car-disk.js` (копия в папке на диске, Chrome/Edge), `library.js` (текущий мозг и его «История»), `runs.js` (записанные заезды), `tabs/*` (по файлу на вкладку), `final/*` (финал).
- `tools/` — сборка, боты, скрипты для кураторов. `app/generated/*` (данные, бандл `app.js`/`app.css`, `chunks/`), `index.html`, `dist/` — **генерируются** `npm run build`, руками не править. Шрифты — `app/fonts/` (свои файлы, не Google Fonts).

## Команды
- `npm start` — статический сервер; `npm run build` — пересобрать (сайт грузит бандл, поэтому после любой правки `app/`, `engine/`, `student/`, `course-key.json`, `tools/bots.json`); `npm run dev` — пересобирать при сохранении; `npm run dev:vite` — сервер Vite для разработки: исходники без бандла, страница обновляется при сохранении (данные из `app/generated/*` — после `npm run build`); `npm run lint` — ESLint и проверка типов (`npm run typecheck`: JS с JSDoc — `tsconfig.json`, `.ts`/`.tsx` строго — `tsconfig.strict.json`); `npm test` — тесты (`test/engine/*` — движок в Node, `test/site.test.mjs` — сайт в Chromium через Playwright, нужен собранный сайт).
- Финал (`app/tabs/final.js` и всё, что он тянет) грузится лениво — не импортировать его из других модулей статически.
- Перед коммитом: `npm run build && npm run lint && npm test`. Сгенерированные файлы коммитятся (Pages раздаёт репозиторий как есть).
- В `.github/workflows` пушить нельзя (у токена нет scope `workflow`) — деплой просто push в `main`.

## Правила, которые нельзя ломать
- **Детерминизм.** Время — в тиках (60 = 1 с), трафик — функция номера тика, трассы — из seed (`mulberry32` + `hashString`). Никакого `Math.random`/`Date` в `engine/` на пути заезда. От этого зависят финал («считаем заранее, показываем запись») и перепроверка результатов.
- **Секретный ключ курса никогда не попадает в репозиторий** (`*private-key*.json` в `.gitignore`). В репо только открытый `course-key.json`.
- **Чужой код** (свой `think` из файла участника) на странице — только после ручного «Разрешить»; в финале — только в Web Worker (`app/final/worker.js`).
- Вкладки не импортируют друг друга — общаются через `state.js`/`library.js` и события (`champion`, `config`, `library`, `reset`, `code`).
- `localStorage` маленький (~5 МБ на весь `jspowwow.github.io`): всё через `app/storage.js`, объёмы держать компактными.

## Проверка
- `npm test`: движок — `node:test` в `test/engine/` (детерминизм, правила финала, файл машины, печать, обучение на примерах); сайт — `test/site.test.mjs` (все вкладки на 1440 и 390: без ошибок в консоли и горизонтальной прокрутки). Новое поведение `engine/` — с тестом.
- Playwright закреплён на версии под Chromium облачного контейнера (`/opt/pw-browsers`); локально один раз `npx playwright install chromium`. Облачная сессия ставит зависимости сама (`.claude/hooks/session-start.sh`).
- Типы: `engine/` — TypeScript, строго (`tsconfig.strict.json`); `app/` пока JS с JSDoc; `student/` намеренно без аннотаций (это код студентов).
- **Переезд на TypeScript (#15) идёт по файлу.** Новый код — `.ts`/`.tsx`, строго (`tsconfig.strict.json`): импорт с расширением (`import { Car } from './car.ts'` — так Node запускает тесты без сборки, нужен Node ≥ 22.18), типы — `import type`, без `enum`/`namespace`/параметров-свойств (`erasableSyntaxOnly`). JSX — `@reely/dommy` (#20), до выхода пакета `.tsx` не писать. `student/` остаётся на JS.
- Зависимости — только из `registry.npmjs.org` (`.npmrc` в корне): иначе `package-lock.json` получит адреса чужого registry, и облачная сессия не поставит пакеты.

## Agent skills

Скиллы лежат в `.claude/skills/` (источники и лицензии — `.claude/skills/README.md`).

### Issue tracker

Задачи — GitHub Issues в `JsPowWow/ai-race`. См. `docs/agents/issue-tracker.md`.

### Triage labels

Стандартные метки: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. См. `docs/agents/triage-labels.md`.

### Domain docs

Один контекст: `CONTEXT.md` в корне и `docs/adr/`, по-русски. См. `docs/agents/domain.md`.
