#!/bin/bash
# Облачная сессия Claude Code: ставим зависимости, чтобы сразу работали npm run build / lint / test.
# Локально не запускается — там всё ставится обычным npm install.
# Асинхронно: сессия стартует сразу, npm install идёт в фоне (обычно несколько секунд).
set -euo pipefail

echo '{"async": true, "asyncTimeout": 300000}'

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Chromium в контейнере уже есть (/opt/pw-browsers); playwright закреплён на версии под него — ничего не качаем
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
npm install --no-audit --no-fund
