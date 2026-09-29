// Панель финала: таблица (участники → живой порядок этапа → общий зачёт) и итоги с номинациями.
// Участников сотни, поэтому строки — For с ключом «ник»: при обновлении строка остаётся той же,
// меняются только её текст и место в списке, а не вся таблица.
import { For, Show, computed, signal, untracked } from '@reely/dommy';
import { STAGES, isSuperfinal, stageLabel } from '../../engine/rally.ts';
import { avatarUrl } from '../../engine/car-file.ts';
import { saveFile } from '../download.ts';
import { resultText, toCsv, toJson, toMarkdown } from './export.ts';
import { countStatuses } from './show.ts';
import type { StageReplay } from './show.ts';
import { calc } from './calc.ts';
import type { Calc } from './calc.ts';
import { pool, racers, avatarShown } from './works.ts';
import { stage, replay, watched, boardOrder, query, found, live } from './stream.ts';
import type { FinalEntry } from './entries.ts';

const LIVE_ROWS = 10; // в живой таблице — первая десятка (и найденный участник, если он ниже)

/** Строка участника: place — место (null — мест ещё нет), move — на сколько мест поднялся (+) или опустился (−), value — результат */
type RacerLine = { kind: 'racer'; key: string; entry: FinalEntry; place: number | null; move: number; value: string };
/** Ключи служебных строк начинаются с @ — в нике GitHub такого знака не бывает */
type Line = RacerLine | { kind: 'gap'; key: '@gap' } | { kind: 'empty'; key: '@empty' };
type BoardView = { title: string; counts: string; lines: Line[] };

const racerLine = (entry: FinalEntry, place: number | null = null, value = '', move = 0): RacerLine =>
  ({ kind: 'racer', key: entry.id, entry, place, move, value });

/** До расчёта: просто список участников */
function entrantsView(): BoardView {
  const list = racers();
  return {
    title: 'Участники',
    counts: '',
    lines: list.length ? list.map((e) => racerLine(e)) : [{ kind: 'empty', key: '@empty' }],
  };
}

/** Этап идёт: первая десятка по живому порядку */
function liveView(): BoardView {
  const order = boardOrder.value;
  const count = countStatuses(order);
  const line = (i: number): RacerLine => {
    const { car, row } = order[i];
    return racerLine(row.entry, i + 1, car.status === 'driving' ? `${Math.floor(car.progress * 100)}%` : resultText(row.result));
  };
  const lines: Line[] = order.slice(0, LIVE_ROWS).map((_, i) => line(i));
  const foundId = found()?.id;
  const foundAt = foundId ? order.findIndex((x) => x.row.entry.id === foundId) : -1;
  if (foundAt >= LIVE_ROWS) lines.push({ kind: 'gap', key: '@gap' }, line(foundAt));
  return {
    title: `${stageLabel(stage.value)} · live`,
    counts: `На трассе ${count.driving} · финиш ${count.finished} · сошли ${count.out}`,
    lines,
  };
}

/** Этап стоит: общий зачёт до него (или после, если его уже досмотрели), в конце — итог финала */
function standingsView(done: Calc, now: StageReplay): BoardView {
  const i = stage.value;
  const seen = watched.value.has(i);
  const counts = (n: number) => `Сумма времени этапов. Не доехал — штраф. ${n} участников.`;
  if (isSuperfinal(i) && seen) {
    const value = (row: Calc['final'][number]) => (row.superTime !== undefined ? resultText(done.results[STAGES].get(row.entry.id)) : `${row.total.toFixed(1)} с`);
    return { title: 'Итог финала', counts: counts(done.final.length), lines: done.final.map((r) => racerLine(r.entry, r.place, value(r))) };
  }
  const shown = seen ? Math.min(i, STAGES - 1) : i - 1; // зачёт после скольких этапов (−1 — ещё ни одного)
  if (shown < 0) {
    return { title: `${stageLabel(i)} · на старте`, counts: `Участников: ${now.rows.length}`, lines: now.rows.map(({ entry }) => racerLine(entry)) };
  }
  const before = shown > 0 ? new Map(done.after[shown - 1].map((r) => [r.entry.id, r.place])) : null;
  const rows = done.after[shown];
  return {
    title: isSuperfinal(i) ? 'Суперфинал · едет первая десятка' : `Общий зачёт после ${shown + 1} ${shown ? 'этапов' : 'этапа'}`,
    counts: counts(rows.length),
    lines: rows.map((r) => {
      const was = before?.get(r.entry.id);
      return racerLine(r.entry, r.place, `${Number.isFinite(r.total) ? r.total.toFixed(1) : '—'} с`, was === undefined ? 0 : was - r.place);
    }),
  };
}

/** Что сейчас в таблице. Каждый раз новые строки — так For узнаёт, что у строки поменялись место или результат */
const view = computed((): BoardView => {
  const done = calc.value;
  const now = replay.value;
  if (!done || !now) return entrantsView();
  return live() ? liveView() : standingsView(done, now);
});

/** Аватар участника (картинка через <img> — скрипты из SVG так не выполняются) или кружок его цвета */
function Avatar({ entry }: { entry: () => FinalEntry }): Node {
  const url = () => (avatarShown(entry().id) ? avatarUrl(entry().avatar) : null);
  return (
    <Show when={url} fallback={() => <span className="car-dot" styles={{ background: () => entry().color }} />}>
      {() => <img className="avatar" src={() => url() ?? ''} alt="" loading="lazy" />}
    </Show>
  );
}

function RacerRow({ line }: { line: () => RacerLine }): Node {
  const entry = () => line().entry;
  const place = () => line().place;
  const move = () => line().move;
  const rowClass = () => {
    const p = place();
    return [entry().id === found()?.id ? 'found' : '', p !== null && p <= 3 ? `p${p}` : ''].filter(Boolean).join(' ');
  };
  return (
    <li className={rowClass}>
      <Show when={() => place() !== null}>{() => <span className="pos">{place}</span>}</Show>
      <Avatar entry={entry} />
      <span className="who"><b>{() => entry().name}</b><span className="kind">{() => `@${entry().author}`}</span></span>
      <Show when={move}>
        {() => <span className={() => (move() > 0 ? 'up' : 'down')}>{() => (move() > 0 ? `▲${move()}` : `▼${-move()}`)}</span>}
      </Show>
      <Show when={() => line().value}>{() => <span className="res">{() => line().value}</span>}</Show>
    </li>
  );
}

function Board(): Node {
  let list: HTMLOListElement | null = null;
  /** Прокрутить таблицу (но не страницу) к найденному участнику */
  const scrollToFound = () => {
    const row = list?.querySelector<HTMLElement>('.found');
    if (list && row) list.scrollTop = row.offsetTop - list.clientHeight / 2;
  };
  return (
    <section className="block board-block">
      <h2 id="fBoardTitle">{() => view().title}</h2>
      <div className="field wide">
        <label htmlFor="fSearch">Найти</label>
        {/* list — атрибут: свойство input.list в DOM только для чтения */}
        <input type="search" id="fSearch" placeholder="ник или имя машины" autocomplete="off"
          elementRef={(input) => input.setAttribute('list', 'fNames')}
          value={query} onInput={(e) => {
            query.value = e.currentTarget.value;
            scrollToFound(); // таблица уже обновилась: сигналы пишут в DOM сразу
          }} />
      </div>
      <datalist id="fNames">
        <For each={() => pool.value.entries} by={(e) => e.id}>{(entry) => <option value={() => entry().author}>{() => entry().name}</option>}</For>
      </datalist>
      <p className="note" id="fCounts">{() => view().counts}</p>
      <ol className="board fboard" id="fBoard" elementRef={(ol) => (list = ol)}>
        <For each={() => view().lines} by={(line) => line.key}>
          {(line) => {
            const first = untracked(line);
            if (first.kind === 'gap') return <li className="gap">…</li>;
            if (first.kind === 'empty') return <li className="empty">Загрузите работы участников</li>;
            return <RacerRow line={line as () => RacerLine} />; // у строки с ключом-ником вид не меняется: всегда участник
          }}
        </For>
      </ol>
    </section>
  );
}

/** Сохранить итоги в файл; что вышло — строкой под кнопками */
async function save(note: { value: string }, filename: string, make: (done: Calc) => string, type?: string): Promise<void> {
  const done = calc.peek();
  if (!done) return;
  try {
    await saveFile(filename, make(done), type);
    note.value = `Сохранено: ${filename}`;
  } catch (e) {
    const declined = typeof e === 'object' && e !== null && 'code' in e && e.code === 'declined';
    note.value = declined ? 'Скачивание отменено.' : `Не получилось сохранить: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** Итоги: видны, когда досмотрели суперфинал */
function Results(): Node {
  const note = signal('');
  const awards = () => calc.value?.awards ?? [];
  return (
    <section className="block setup" id="fResults" hidden={() => !calc.value || !watched.value.has(STAGES)}>
      <h2>Итоги</h2>
      <div className="awards" id="fAwards">
        <For each={awards} by={(award) => award.title}>
          {(award) => {
            const who = () => award().entry;
            return (
              <div className="award">
                <b>{() => award().title}</b>
                {() => { const e = who(); return e ? `${e.name} (@${e.author}) — ` : ''; }}
                {() => award().text}
              </div>
            );
          }}
        </For>
      </div>
      <div className="row">
        <button className="btn small" id="fSaveMd" onClick={() => save(note, 'RESULTS.md', toMarkdown, 'text/markdown')}>RESULTS.md</button>
        <button className="btn small" id="fSaveCsv" onClick={() => save(note, 'ai-race-results.csv', toCsv, 'text/csv')}>Таблица .csv</button>
        <button className="btn small" id="fSaveJson" onClick={() => save(note, 'results.json', toJson)}>results.json</button>
      </div>
      <p className="note" id="fSaveNote" aria={{ role: 'status' }}>{note}</p>
    </section>
  );
}

/** Таблица и итоги — нижние секции панели финала */
export function Standings(): Node {
  return (
    <>
      <Board />
      <Results />
    </>
  );
}
