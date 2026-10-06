---
paths:
  - "app/final/**"
  - "app/tabs/final.tsx"
  - "engine/world/rally.ts"
  - "engine/course/seal.ts"
  - "engine/course/compile.ts"
  - "tools/collect-entries.mjs"
  - "tools/make-demo-entries.mjs"
  - "tools/seal.mjs"
  - "tools/course-keys.mjs"
---
# Финал курса и запечатанная сдача

- Финал: 3 этапа + суперфинал топ-10, сумма времени, сход = лимит × (2 − доля трассы), ничьи делят место. Всё считается заранее в Web Worker, на стриме — запись (`REC_EVERY` тиков).
- Worker (`app/final/worker.ts`) до запуска чужого кода отнимает сеть, `postMessage`, таймеры, `eval`, конструкторы функций, замораживает `Math` и прототипы; `Math.random` — детерминированный от «ник + этап». Не ослаблять. Зависание — таймаут в `pool.ts`.
- Worker собирается в строку при сборке (`app/generated/race-worker.js`) — после правок `app/final/job.ts`/`worker.ts` и всего, что они импортируют, нужен `npm run build`.
- Запечатанный файл: `ai-race/sealed@1`, WebCrypto ECDH P-256 → HKDF-SHA-256 → AES-GCM, внутри `{ login, car, sealedAt }`. Формат менять только с поддержкой старого.
- Секретный ключ — только у кураторов, в браузере используется в памяти и никуда не отправляется. Никогда не класть в репозиторий, логи, артефакты.
- Репетиция: `npm run demo` (запечатанные работы с «вором», опечаткой, зависшим кодом; демо-ключ рядом).
