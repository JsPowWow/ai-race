// Итоги финала в файлы: RESULTS.md (опубликовать в репозитории), CSV (таблица для баллов), JSON (всё подряд).
import { STAGES, stageLabel, stageSeed, stageTime } from '../../engine/world/rally.ts';
import type { StageResult } from '../../engine/world/rally.ts';
import type { Calc } from './calc.ts';

/** «16,17 с» · «сошёл на 63%» · «ошибка в коде» */
export function resultText(result: StageResult | null | undefined): string {
  if (!result) return '—';
  const percent = `${Math.floor(result.progress * 100)}%`;
  switch (result.status) {
    case 'finished': return `${((result.finishTick ?? result.ticks) / 60).toFixed(2).replace('.', ',')} с`;
    case 'crashed': return `${result.crashedInto === 'car' ? 'авария' : 'бордюр'} на ${percent}`;
    case 'stalled': return `заглох на ${percent}`;
    case 'timeout': return `не успел: ${percent}`;
    case 'hung': return 'завис';
    default: return 'ошибка в коде';
  }
}

const BOM = String.fromCharCode(0xfeff);
const num = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : '—');
const ruNum = (x: number) => num(x).replace('.', ',');
const stageNumbers = (count: number) => Array.from({ length: count }, (_, i) => i);

/** Строки итоговой таблицы: всё, что нужно файлам */
function rowsOf(calc: Calc) {
  return calc.final.map((row) => ({
    place: row.place,
    author: row.entry.author,
    name: row.entry.name,
    stages: stageNumbers(STAGES).map((s) => calc.results[s].get(row.entry.id)),
    total: row.total,
    superfinal: calc.results[STAGES].get(row.entry.id) ?? null,
    finished: row.finished,
    twins: row.entry.twins,
    code: !!row.entry.code,
  }));
}

/** Кого сняли и почему */
const disqualified = (calc: Calc) => calc.entries.filter((e) => e.dq);

export function toMarkdown(calc: Calc): string {
  const head = ['Место', 'Участник', 'Машина', ...stageNumbers(STAGES).map(stageLabel), 'Сумма, с', 'Суперфинал'];
  const cell = (text: string | number) => String(text).replace(/\|/g, '\\|');
  const lines = [
    '# AI Race — итоги финала',
    '',
    `Секретная фраза: **${cell(calc.secret)}**. Трассы: ${stageNumbers(STAGES + 1).map((i) => `«${stageSeed(calc.secret, i)}»`).join(', ')}.`,
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
  const dq = disqualified(calc);
  if (dq.length) lines.push('', '## Сняты', '', ...dq.map((e) => `- @${cell(e.author)} — ${cell(e.dq ?? '')}`));
  lines.push('', 'Сумма — время трёх этапов. Не доехал — штраф: лимит времени × (2 − доля трассы).', '');
  return lines.join('\n');
}

export function toCsv(calc: Calc): string {
  const quote = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const stages = stageNumbers(STAGES);
  const head = ['place', 'github', 'car', ...stages.map((s) => `stage${s + 1}`), ...stages.map((s) => `stage${s + 1}_seconds`), 'total_seconds', 'superfinal', 'finished_stages', 'same_brain_as', 'own_code'];
  const rows = rowsOf(calc).map((r) => [
    r.place, r.author, r.name,
    ...r.stages.map(resultText), ...r.stages.map((x) => num(stageTime(x))),
    num(r.total), r.superfinal ? resultText(r.superfinal) : '', r.finished, r.twins > 1 ? r.twins - 1 : 0, r.code ? 'yes' : 'no',
  ]);
  // BOM (U+FEFF) в начале — чтобы Excel узнал UTF-8 и не показал кириллицу кракозябрами
  return `${BOM}${[head, ...rows].map((row) => row.map(quote).join(',')).join('\n')}\n`;
}

export function toJson(calc: Calc): string {
  return JSON.stringify({
    secret: calc.secret,
    seeds: stageNumbers(STAGES + 1).map((i) => stageSeed(calc.secret, i)),
    awards: calc.awards.map((a) => ({ title: a.title, github: a.entry?.author ?? null, text: a.text })),
    standings: rowsOf(calc).map(({ stages, superfinal, ...r }) => ({
      ...r,
      stages: stages.map((x) => (x ? { status: x.status, ticks: x.ticks, progress: +x.progress.toFixed(4), result: resultText(x) } : null)),
      superfinal: superfinal && resultText(superfinal),
    })),
    disqualified: disqualified(calc).map((e) => ({ github: e.author, reason: e.dq })),
  }, null, 1);
}
