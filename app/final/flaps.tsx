// «Финал», табло-флапы у трассы: в заезде — первая десятка и найденный поиском, между этапами —
// общий зачёт со стрелками ▲▼ (на сколько мест поднялся или опустился). Данные — те же, что у таблицы (board.tsx).
import type { FlapColumn, FlapRow } from '../components/flap-board.tsx';
import { StageFlaps } from '../components/stage-flaps.tsx';
import { found, live } from './stream.ts';
import { view, type Line, type RacerLine } from './board.tsx';

type Key = 'place' | 'name' | 'move' | 'value';
const COLUMNS: readonly FlapColumn<Key>[] = [
  { key: 'place', title: '№', width: 3, align: 'end' },
  { key: 'name', title: 'Машина', width: 11 },
  { key: 'move', title: '±', width: 3, align: 'end' },
  { key: 'value', title: 'Итог', width: 6, align: 'end' },
];

const isRacer = (line: Line): line is RacerLine => line.kind === 'racer';

function toRow(line: RacerLine, foundId: string | undefined): FlapRow<Key> {
  const { entry, place, move } = line;
  return {
    id: entry.id,
    color: entry.color,
    rank: place ?? undefined,
    you: entry.id === foundId,
    cells: { place: place === null ? '' : String(place), name: entry.name, move: move > 0 ? `▲${move}` : move < 0 ? `▼${-move}` : '', value: line.short },
    tones: move ? { move: move > 0 ? 'up' : 'down' } : undefined,
  };
}

/** Пропуск между первыми и найденным */
const GAP: FlapRow<Key> = { id: '@gap', color: 'transparent', cells: { place: '', name: '···', move: '', value: '' } };

/** Строки, что влезут в max: сверху по порядку, а найденный — всегда на виду, после «···» */
function rows(max: number): FlapRow<Key>[] {
  const foundId = found()?.id;
  const all = view.value.lines.flatMap((line): FlapRow<Key>[] => (line.kind === 'racer' ? [toRow(line, foundId)] : line.kind === 'gap' ? [GAP] : []));
  if (all.length <= max) return all;
  const at = all.findIndex((row) => row.you);
  if (at < max) return all.slice(0, max);
  return [...all.slice(0, Math.max(0, max - 2)), GAP, all[at]];
}

/** Для читалки экрана: кто первый и где найденный */
function summary(): string {
  const racers = view.value.lines.filter(isRacer);
  const [first] = racers;
  if (!first || first.place === null) return '';
  const who = found();
  const at = who ? racers.findIndex((l) => l.entry.id === who.id) : -1;
  const where = at > 0 ? ` ${who?.name} — ${at + 1}-й.` : '';
  return `${view.value.title}. ${live() ? 'Впереди' : 'Первый'} — ${first.entry.name}.${where}`;
}

export function FinalFlaps({ host }: { host: HTMLElement }): Node {
  return <StageFlaps host={host} label="Табло финала" title={() => view.value.flapTitle} columns={COLUMNS} rows={rows} summary={summary} />;
}
