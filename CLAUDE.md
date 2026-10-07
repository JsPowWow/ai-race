# AI Race

Учебный симулятор для курса JavaScript: машинка с лучами-сенсорами, маленькая нейросеть, обучение на примерах и роем (генетический алгоритм), экзамен, гонка и финал курса на сотни участников. Сайт — https://jspowwow.github.io/ai-race/ (GitHub Pages из ветки `main`, папка `/`).

Подробности для людей — @README.md. Здесь — то, что нужно знать, прежде чем менять код.

## Язык и тон
- Все тексты интерфейса, комментарии, коммиты и ответы — **по-русски**, просто, для начинающих.
- Код должен быть таким, чтобы его не стыдно показать студентам: маленькие модули, понятные имена, комментарий — «зачем», а не «что».

## Раскладка
- `student/` — пять файлов, которые пишут студенты. Намеренно простые.
- `engine/` — мир без DOM, по слоям-будущим пакетам (`engine/README.md`): `core` (математика, seed, точка, наклон, цвет) → `net` (мозг) → `world` (трассы, машина, трафик, декор, ралли) → `learn` (рой, примеры) → `course` (файл машины, сборка, контрольный заезд, печать, код студента); `draw` (холст сверху, `draw/cockpit/` — вид из машины) и `sound` (счёт мотора) — над `world`. Слой берёт только из нижних (`test/engine/layers.test.mjs`). Работает и в Node.
- `app/` — интерфейс: `main.ts` (вкладки, кадровый цикл), `state.ts` (состояние, события), `garage.ts` (гараж: машины, пересесть, файл машины) + `car-store.ts`/`car-writer.ts` (где лежат: OPFS через Worker или `localStorage`), `car-disk.ts` (копия в папке на диске, Chrome/Edge), `library.ts` (текущий мозг и его «История»), `runs.ts` (записанные заезды), `tabs/*` (по файлу на вкладку), `final/*` (финал).
- `tools/` — сборка, боты, скрипты для кураторов. `app/generated/*` (данные, бандл `app.js`/`app.css`, `chunks/`, шрифты в `assets/`), `index.html`, `dist/` — **генерируются** `npm run build`, руками не править. Шрифты — `app/fonts/` (свои файлы, не Google Fonts).

## Команды
- `npm run dev` — сервер Vite для разработки: исходники без сборки, страница обновляется при сохранении, `app/generated/*.js` (данные, Workers строкой) пишет сам (`tools/generate.mjs`); `npm run build` — собрать сайт Vite'ом (`tools/build.mjs`; сайт грузит сборку, поэтому после любой правки `app/`, `engine/`, `student/`, `course-key.json`, `tools/bots.json`); `npm start` — статический сервер для собранного; `npm run lint` — ESLint и проверка типов (`npm run typecheck`: `tsconfig.json`, строго); `npm test` — тесты (`test/engine/*` — движок в Node, `test/site.test.mjs` — сайт в Chromium через Playwright, нужен собранный сайт).
- Финал (`app/tabs/final.tsx` и всё, что он тянет) грузится лениво — не импортировать его из других модулей статически.
- Перед коммитом: `npm run build && npm run lint && npm test`. Сгенерированные файлы коммитятся (Pages раздаёт репозиторий как есть).
- В `.github/workflows` пушить нельзя (у токена нет scope `workflow`) — деплой просто push в `main`.

## Правила, которые нельзя ломать
- **Детерминизм.** Время — в тиках (60 = 1 с), трафик — функция номера тика, трассы — из seed (`mulberry32` + `hashString`). Никакого `Math.random`/`Date` в `engine/` на пути заезда. От этого зависят финал («считаем заранее, показываем запись») и перепроверка результатов.
- **Секретный ключ курса никогда не попадает в репозиторий** (`*private-key*.json` в `.gitignore`). В репо только открытый `course-key.json`.
- **Чужой код** (свой `think` из файла участника) на странице — только после ручного «Разрешить»; в финале — только в Web Worker (`app/final/worker.ts`).
- Вкладки не импортируют друг друга — общаются через `state.ts`/`library.ts` и события (`champion`, `config`, `library`, `reset`, `code`).
- `localStorage` маленький (~5 МБ на весь `jspowwow.github.io`): всё через `app/storage.ts`, объёмы держать компактными.

## Проверка
- `npm test`: движок — `node:test` в `test/engine/` (детерминизм, правила финала, файл машины, печать, обучение на примерах); сайт — `test/site.test.mjs` (все вкладки на 1440 и 390: без ошибок в консоли и горизонтальной прокрутки). Новое поведение `engine/` — с тестом.
- Playwright закреплён на версии под Chromium облачного контейнера (`/opt/pw-browsers`); локально один раз `npx playwright install chromium`. Облачная сессия ставит зависимости сама (`.claude/hooks/session-start.sh`).
- Типы: `engine/` и `app/` — TypeScript, строго (`tsconfig.json`); `student/` — намеренно JS без аннотаций (это код студентов), форму его экспортов описывает `StudentFiles` в `app/student-code.ts`.
- **Код — `.ts`/`.tsx`**: импорт с расширением (`import { Car } from './car.ts'` — так Node запускает тесты без сборки, нужен Node ≥ 22.18), типы — `import type`, без `enum`/`namespace`/параметров-свойств (`erasableSyntaxOnly`). Интерфейс — JSX на `@reely/dommy` (#20), как устроен — `.claude/rules/ui.md`.
- Зависимости — только из `registry.npmjs.org` (`.npmrc` в корне): иначе `package-lock.json` получит адреса чужого registry, и облачная сессия не поставит пакеты.

## Agent skills

Скиллы лежат в `.claude/skills/` (источники и лицензии — `.claude/skills/README.md`).

### Issue tracker

Задачи — GitHub Issues в `JsPowWow/ai-race`. См. `docs/agents/issue-tracker.md`.

### Triage labels

Стандартные метки: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. См. `docs/agents/triage-labels.md`.

### Domain docs

Один контекст: `GLOSSARY.md` в корне и `docs/adr/`, по-русски. См. `docs/agents/domain.md`.
