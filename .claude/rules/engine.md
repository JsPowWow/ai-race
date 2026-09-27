---
paths:
  - "engine/**"
  - "tools/sim.mjs"
  - "tools/train-bots.mjs"
---
# engine/

- Никакого DOM, `window`, `localStorage`: модуль должен работать в Node и в Web Worker.
- Всё на пути заезда детерминировано: тики, seed, трафик через `trafficAt(track, traffic, tick)` / `trafficSnapshot`. Не добавлять `Math.random`, `Date.now`, зависимость от FPS.
- `Car.step` и формат входов сети (`[...лучи, скорость/maxSpeed]`, `car.lastInputs`) — общий контракт для «Я учу», роя, экзамена, гонки и финала. Меняешь — проверь все пять.
- Меняешь физику (`CAR`), полосы (`LANES`) или трафик — переобучи ботов: `npm run bots`, затем `npm run build`.
- Обучение на примерах (`imitation.js`) считает активации варианта «Плавный» (`smooth`): tanh(2z) внутри, sigmoid(3z) на выходе. Меняешь одно — меняй и `student/think.js`.
