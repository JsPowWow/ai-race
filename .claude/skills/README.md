# Скиллы для Claude Code

Готовые инструкции, по которым Claude Code работает в этом репозитории. Скопированы из открытых репозиториев
как обычные файлы: их можно читать и править. Скилл — папка с `SKILL.md`; Claude подхватывает его сам, когда задача подходит
под описание, или по команде `/<имя>`.

| Откуда | Коммит | Лицензия | Скиллы |
|---|---|---|---|
| [mattpocock/skills](https://github.com/mattpocock/skills) — `engineering/`, `productivity/` | `c55ee46` | MIT | `codebase-design`, `improve-codebase-architecture`, `domain-modeling`, `tdd`, `diagnosing-bugs`, `code-review`, `prototype`, `research`, `implement`, `to-spec`, `to-tickets`, `triage`, `wayfinder`, `grill-with-docs`, `grill-me`, `grilling`, `handoff`, `teach`, `to-questionnaire`, `wait-what`, `writing-for-agents`, `resolving-merge-conflicts`, `wizard`, `ask-matt`, `setup-matt-pocock-skills` |
| [anthropics/skills](https://github.com/anthropics/skills) | `3337550` | Apache-2.0 (в папке) | `frontend-design` |
| [addyosmani/web-quality-skills](https://github.com/addyosmani/web-quality-skills) | `afa8da9` | MIT | `core-web-vitals`, `performance`, `accessibility`, `best-practices`, `seo`, `web-quality-audit` |
| [pbakaus/impeccable](https://github.com/pbakaus/impeccable) — `plugin/` (4.4.0) | `9d715cc` | Apache-2.0 | `impeccable` (24 команды: `/impeccable critique`, `audit`, `polish`, `shape`…) + агенты в `.claude/agents/impeccable-*.md` |
| [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) + [web-interface-guidelines](https://github.com/vercel-labs/web-interface-guidelines) | `063bee9` / `e3d624b` | MIT | `web-design-guidelines` |

Тексты лицензий — в `_licenses/`.

Что изменено при копировании:
- `impeccable` поставлен без хуков (не гоняет детектор после каждой правки); детектор — вручную: `.claude/skills/impeccable/scripts/impeccable detect --json <файлы>`. Бинарник детектора лаунчер скачивает сам при первом запуске (в облачном контейнере — из npm-пакета `@impeccable/cli-linux-x64` в `~/.impeccable/bin/`);
- убраны `agents/openai.yaml` (настройки для Codex, Claude Code их не читает);
- `web-design-guidelines` читает правила из локального `rules.md`, а не скачивает их при каждом запуске.

Обновить: склонировать репозиторий-источник и заменить папки скиллов, затем поправить коммиты в таблице.
