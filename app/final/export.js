// Итоги финала в файлы: RESULTS.md (опубликовать в репозитории), CSV (таблица для баллов), JSON (всё подряд).
import { STAGES, stageLabel, stageSeed, stageTime } from '../../engine/rally.ts';

/** «16,17 с» · «сошёл на 63%» · «ошибка в коде» */
export function resultText(result) {
  if (!result) return '—';
  switch (result.status) {
    case 'finished': return `${(result.finishTick / 60).toFixed(2).replace('.', ',')} с`;
    case 'crashed': return `${result.crashedInto === 'car' ? 'авария' : 'бордюр'} на ${Math.floor(result.progress * 100)}%`;
    case 'stalled': return `заглох на ${Math.floor(result.progress * 100)}%`;
    case 'timeout': return `не успел: ${Math.floor(result.progress * 100)}%`;
    case 'hung': return 'завис';
    default: return 'ошибка в коде';
  }
}

const num = (x) => (Number.isFinite(x) ? x.toFixed(2) : '—');
const ruNum = (x) => num(x).replace('.', ',');

function rowsOf(calc) {
  return calc.final.map((row) => ({
    place: row.place,
    author: row.entry.author,
    name: row.entry.name,
    stages: Array.from({ length: STAGES }, (_, s) => calc.results[s].get(row.entry.id)),
    total: row.total,
    superfinal: calc.results[STAGES].get(row.entry.id) ?? null,
    finished: row.finished,
    twins: row.entry.twins,
    code: !!row.entry.code,
  }));
}

export function toMarkdown(calc, entries) {
  const head = ['Место', 'Участник', 'Машина', ...Array.from({ length: STAGES }, (_, s) => stageLabel(s)), 'Сумма, с', 'Суперфинал'];
  const cell = (text) => String(text).replace(/\|/g, '\\|');
  const lines = [
    '# AI Race — итоги финала',
    '',
    `Секретная фраза: **${cell(calc.secret)}**. Трассы: ${Array.from({ length: STAGES + 1 }, (_, i) => `«${stageSeed(calc.secret, i)}»`).join(', ')}.`,
    'Любой может перепроверить свой заезд: открыть AI Race, вкладку «Гонка», свой файл и seed этапа.',
    '',
    '## Номинации',
    '',
    ...calc.awards.map((a) => `- **${a.title}** — ${a.entry ? `${cell(a.entry.name)} (@${cell(a.entry.author)}), ` : ''}${cell(a.text)}`),
    '',
    '## Таблица',
    '',
    `| ${head.join(' | ')} |`,
    `| ${head.map(() => '---').join(' | ')} |`,
    ...rowsOf(calc).map((r) => `| ${r.place} | @${cell(r.author)} | ${cell(r.name)} | ${r.stages.map(resultText).join(' | ')} | ${ruNum(r.total)} | ${r.superfinal ? resultText(r.superfinal) : ''} |`),
  ];
  const dq = entries.filter((e) => e.dq);
  if (dq.length) lines.push('', '## Сняты', '', ...dq.map((e) => `- @${cell(e.author)} — ${cell(e.dq)}`));
  lines.push('', 'Сумма — время трёх этапов. Не доехал — штраф: лимит времени × (2 − доля трассы).', '');
  return lines.join('\n');
}

export function toCsv(calc) {
  const quote = (v) => `"${String(v).replace(/"/g, '""')}"`;
  const head = ['place', 'github', 'car', ...Array.from({ length: STAGES }, (_, s) => `stage${s + 1}`), ...Array.from({ length: STAGES }, (_, s) => `stage${s + 1}_seconds`), 'total_seconds', 'superfinal', 'finished_stages', 'same_brain_as', 'own_code'];
  const rows = rowsOf(calc).map((r) => [
    r.place, r.author, r.name,
    ...r.stages.map(resultText), ...r.stages.map((x) => num(stageTime(x))),
    num(r.total), r.superfinal ? resultText(r.superfinal) : '', r.finished, r.twins > 1 ? r.twins - 1 : 0, r.code ? 'yes' : 'no',
  ]);
  return `\uFEFF${[head, ...rows].map((row) => row.map(quote).join(',')).join('\n')}\n`;
}

export function toJson(calc, entries) {
  return JSON.stringify({
    secret: calc.secret,
    seeds: Array.from({ length: STAGES + 1 }, (_, i) => stageSeed(calc.secret, i)),
    awards: calc.awards.map((a) => ({ title: a.title, github: a.entry?.author ?? null, text: a.text })),
    standings: rowsOf(calc).map(({ stages, superfinal, ...r }) => ({
      ...r,
      stages: stages.map((x) => ({ status: x.status, ticks: x.ticks, progress: +x.progress.toFixed(4), result: resultText(x) })),
      superfinal: superfinal && resultText(superfinal),
    })),
    disqualified: entries.filter((e) => e.dq).map((e) => ({ github: e.author, reason: e.dq })),
  }, null, 1);
}
