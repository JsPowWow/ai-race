---
name: web-design-guidelines
description: Review UI code for Web Interface Guidelines compliance. Use when asked to "review my UI", "check accessibility", "audit design", "review UX", or "check my site against best practices".
metadata:
  author: vercel
  version: "1.0.0"
  argument-hint: <file-or-pattern>
---

# Web Interface Guidelines

Review files for compliance with Vercel's Web Interface Guidelines.

## How It Works

1. Read the rules in [rules.md](./rules.md) (a pinned copy of vercel-labs/web-interface-guidelines `command.md`).
2. Read the specified files (or ask the user for files/pattern).
3. Check against all rules; skip rules that are about React/Next.js when the code is plain DOM.
4. Output findings in the terse `file:line` format described in rules.md.

To refresh the rules, replace rules.md with the latest
https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md
