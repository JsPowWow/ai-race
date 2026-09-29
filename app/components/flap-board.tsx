// Табло «как в аэропорту»: у каждой буквы своя плитка. Поменялся текст — плитки перелистываются
// через пару случайных на вид букв и встают на новую. Строки стоят на местах (1-е, 2-е…),
// а меняются надписи на них: обогнал — имя переехало строкой выше, как на настоящем табло.
import { effect, onCleanup, untracked, For, Show } from '@reely/dommy';
import { avatarUrl } from '../../engine/car-file.ts';

/** Колонка табло: заголовок, сколько плиток, по какому краю прижать текст */
export type FlapColumn<Key extends string> = { key: Key; title: string; width: number; align?: 'start' | 'end' };

/**
 * Строка табло. cells — текст по колонкам; color — цветная метка машины; avatar — SVG-аватар (как эмблема
 * авиакомпании на табло аэропорта); rank — место (первые три подсвечены: золото, серебро, бронза); you — это ты.
 */
export type FlapRow<Key extends string> = {
  id: string | number; color: string; cells: Record<Key, string>;
  avatar?: string | null; rank?: number; you?: boolean;
};

/** Высота строки в пикселях — одна на CSS и на расчёт, сколько строк влезет */
export const FLAP_ROW_PX = 26;

/** Буквы, через которые листается плитка: как барабан настоящего табло */
const DRUM = 'АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЭЮЯ0123456789+-,:/';
/** Сколько промежуточных букв показать и как быстро (мс на одну) */
const STEPS = 2;
const STEP_MS = 55;
/** Волна: каждая следующая плитка строки начинает листаться чуть позже */
const WAVE_MS = 18;

const calm = matchMedia('(prefers-reduced-motion: reduce)');

/** Текст ровно на width плиток: короткий дополняем пробелами, длинный обрезаем */
function fit(text: string, width: number, align: 'start' | 'end'): string {
  const cut = [...text].slice(0, width).join('');
  return align === 'end' ? cut.padStart(width) : cut.padEnd(width);
}

/** Промежуточная буква: не случайная, а по кругу барабана — одно и то же изменение листается одинаково */
const drumAfter = (target: string, step: number): string =>
  DRUM[(Math.max(0, DRUM.indexOf(target.toUpperCase())) + (step + 1) * 7) % DRUM.length] ?? target;

/**
 * Одна надпись из плиток. Плитки — только для глаз (aria-hidden): читалка экрана
 * получает текст целиком из соседнего невидимого span, а не по буквам.
 */
export function FlapText({ text, width, align = 'start' }: { text: () => string; width: number; align?: 'start' | 'end' }): Node {
  const tiles = Array.from({ length: width }, () => <span className="flap-tile"> </span>) as HTMLElement[];
  const timers = new Set<number>();
  const later = (ms: number, fn: () => void) => {
    const id = window.setTimeout(() => (timers.delete(id), fn()), ms);
    timers.add(id);
  };
  const stopAll = () => {
    for (const id of timers) clearTimeout(id);
    timers.clear();
  };
  onCleanup(stopAll);

  /** Плитка показывает букву и перелистывается: два класса по очереди перезапускают анимацию */
  const show = (tile: HTMLElement, char: string) => {
    tile.textContent = char;
    const odd = tile.classList.toggle('turn-a');
    tile.classList.toggle('turn-b', !odd);
  };

  let shown = fit('', width, align);
  effect(() => {
    const next = fit(text(), width, align);
    untracked(() => {
      stopAll(); // новый текст пришёл раньше, чем долистался старый, — сразу к новому
      const before = shown;
      shown = next;
      [...next].forEach((char, i) => {
        const tile = tiles[i];
        if (!tile) return;
        // буква та же — но плитка могла не долистаться до неё, пока её не прервали: ставим сразу
        if (before[i] === char || calm.matches) return void (tile.textContent !== char && (tile.textContent = char));
        for (let step = 0; step < STEPS; step++) later(i * WAVE_MS + step * STEP_MS, () => show(tile, char === ' ' ? ' ' : drumAfter(char, step)));
        later(i * WAVE_MS + STEPS * STEP_MS, () => show(tile, char));
      });
    });
  });

  return (
    <span className={`flap-text ${align}`}>
      {/* не влезло — полный текст во всплывающей подсказке */}
      <span className="flap-tiles" title={() => ([...text()].length > width ? text() : null)} aria={{ ariaHidden: 'true' }}>{tiles}</span>
      <span className="sr-only">{() => text().trim()}</span>
    </span>
  );
}

/**
 * Табло: заголовки колонок и строки по местам. rows — уже по порядку и уже столько,
 * сколько влезает (какие выбрать, если все не влезают, — pickRows).
 */
export function FlapBoard<Key extends string>({ title, columns, rows, label, fill = () => 0 }: {
  title: () => string;
  columns: readonly FlapColumn<Key>[];
  rows: () => readonly FlapRow<Key>[];
  label: string;
  /** Сколько строк держать всегда: недостающие — пустые плитки, как на настоящем табло */
  fill?: () => number;
}): Node {
  const blank = (slot: number): FlapRow<Key> => ({ id: `blank-${slot}`, color: 'transparent', cells: blankCells(columns) });
  // строка табло = место на табло, а не участник: при обгоне листаются надписи, строки не прыгают
  const slots = () => {
    const list = rows();
    const all = [...list, ...Array.from({ length: Math.max(0, fill() - list.length) }, (_, k) => blank(list.length + k))];
    return all.map((row, slot) => ({ slot, row, empty: slot >= list.length }));
  };
  return (
    <div className="flap-board-inner" aria={{ role: 'table', ariaLabel: label }} styles={{ '--flap-row': `${FLAP_ROW_PX}px` }}>
      <div className="flap-title" aria={{ ariaHidden: 'true' }}>
        <FlapText text={title} width={18} />
      </div>
      <div className="flap-row flap-head" aria={{ role: 'row' }}>
        <span className="flap-dot" aria={{ ariaHidden: 'true' }} />
        <span className="flap-logo" aria={{ ariaHidden: 'true' }} />
        {columns.map((c) => <span className={`flap-cell ${c.align ?? 'start'}`} styles={{ '--w': String(c.width) }} aria={{ role: 'columnheader' }}>{c.title}</span>)}
      </div>
      <For each={slots} by={(s) => s.slot}>
        {(slot) => {
          const row = () => slot().row;
          return (
            // пустая строка — только для глаз: читалке экрана незачем перечислять пустые места
            <div className={() => (row().you ? 'flap-row you' : 'flap-row')} data-rank={() => String(row().rank ?? '')}
              aria={{ role: 'row', ariaHidden: () => (slot().empty ? 'true' : null) }}>
              <span className="flap-dot" styles={{ '--dot': () => row().color }} aria={{ ariaHidden: 'true' }} />
              {/* SVG — только через <img>: так браузер не выполнит из картинки скрипт и ничего не загрузит */}
              <span className="flap-logo" aria={{ ariaHidden: 'true' }}>
                <Show when={() => row().avatar}>{() => <img src={() => avatarUrl(row().avatar) ?? ''} alt="" />}</Show>
              </span>
              {columns.map((c) => (
                <span className="flap-cell" styles={{ '--w': String(c.width) }} aria={{ role: 'cell' }}>
                  <FlapText text={() => row().cells[c.key]} width={c.width} align={c.align} />
                </span>
              ))}
            </div>
          );
        }}
      </For>
    </div>
  );
}

/** Пустые надписи во всех колонках */
function blankCells<Key extends string>(columns: readonly FlapColumn<Key>[]): Record<Key, string> {
  return Object.fromEntries(columns.map((c) => [c.key, ''])) as Record<Key, string>;
}

/**
 * Какие строки показать, если все не влезают в max: сверху — лидеры, а ты со соседями
 * (кто впереди, кто сзади) — всегда на виду. На телефоне max = 4: лидер, впереди, ты, сзади.
 */
export function pickRows<R extends { you?: boolean }>(rows: readonly R[], max: number): R[] {
  if (rows.length <= max) return [...rows];
  const you = rows.findIndex((r) => r.you);
  if (you < 0 || you < max - 1 || max < 4) return rows.slice(0, max); // ты и так в первых — или тебя нет
  const around = rows.slice(you - 1, you + 2); // впереди, ты, сзади (сзади может не быть)
  const top = max - around.length;
  return [...rows.slice(0, top), ...around];
}
