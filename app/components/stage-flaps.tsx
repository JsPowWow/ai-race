// Табло-флапы у трассы: на широком экране — колонка справа от неё (строк — сколько влезает,
// свободные — пустые плитки), на узком — полоса над ней в четыре строки.
// Хозяин — пустой <aside class="flap-board" data-panel="…"> в .stage (app/markup.html): его прячет main.ts.
import { FlapBoard, FLAP_ROW_PX, type FlapColumn, type FlapRow } from './flap-board.tsx';
import { media, size, throttled } from '@reely/dommy/kit';

/** Сбоку от трассы — только когда трасса и без того широкая; иначе табло над ней. То же условие — в stage.css */
const SIDE_QUERY = '(min-width: 1180px), (min-width: 760px) and (max-width: 1000px)';
/** Заголовок табло и строка заголовков колонок — тоже строки табло */
const HEAD_ROWS = 2;
/** Над трассой — четыре строки: лидер, кто впереди тебя, ты, кто сзади */
const TOP_ROWS = 4;
/** Пересказ для читалки экрана — не чаще раза в столько миллисекунд */
const SAY_EVERY_MS = 5000;

export function StageFlaps<Key extends string>({ host, label, title, columns, rows, summary }: {
  host: HTMLElement;
  label: string;
  title: () => string;
  columns: readonly FlapColumn<Key>[];
  /** Строки, которые влезут в max: какие выбрать, решает вкладка (pickRows — лидеры и ты с соседями) */
  rows: (max: number) => readonly FlapRow<Key>[];
  /** Что сказать вслух: главное, коротко («Лидер — Торетто. Ты — 2-й из 5») */
  summary: () => string;
}): Node {
  const side = media(SIDE_QUERY);
  const box = size(host);
  // сбоку — сколько строк влезает; пока колонку не измерили (высота 0), строк нет, а не одна случайная
  const fits = () => (side.value ? Math.max(0, Math.floor(box.value.height / FLAP_ROW_PX) - HEAD_ROWS) : TOP_ROWS);
  const said = throttled(summary, SAY_EVERY_MS);
  return (
    <>
      <FlapBoard label={label} title={title} columns={columns} rows={() => rows(fits())} fill={() => (side.value ? fits() : 0)} />
      <p className="sr-only" aria={{ ariaLive: 'polite' }}>{() => said.value}</p>
    </>
  );
}
