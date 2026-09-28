---
paths:
  - "engine/**"
  - "tools/sim.mjs"
  - "tools/train-bots.mjs"
---
# engine/

- Никакого DOM, `window`, `localStorage`: модуль должен работать в Node и в Web Worker.
- Всё на пути заезда детерминировано: тики, seed, трафик через `trafficAt(track, traffic, tick)` / `trafficSnapshot`. Не добавлять `Math.random`, `Date.now`, зависимость от FPS.
- `Car.step` и формат входов сети (`car.inputs()`: `[s1…sn, скорость/maxSpeed, s1′…sn′, m1…m3]`, `car.lastInputs`) и выходов (4 кнопки, потом заметки) — общий контракт для «Я учу», роя, экзамена, гонки и финала. Форма одна на весь курс — `engine/brain.js`, решение — `docs/adr/0001-*`. Меняешь — проверь все пять.
- Заметки: веса от них в новом мозге нули (`createBrain`), обучение на примерах их не трогает (ошибка только по кнопкам). Не ломать — иначе «Я учу» выучит «жми то же, что тиком раньше».
- Меняешь физику (`CAR`), полосы (`LANES`) или трафик — переобучи ботов: `npm run bots`, затем `npm run build`.
- Обучение на примерах (`imitation.js`) считает активации варианта «Плавный» (`smooth`): tanh(2z) внутри, sigmoid(3z) на выходе. Меняешь одно — меняй и `student/think.js`.
