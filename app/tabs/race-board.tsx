// «Гонка», таблица и номинации. Строки не перерисовываются: при обгоне строка плавно переезжает на новое место (flip).
import { For, Show } from '@reely/dommy';
import { CarDot } from '../components/car-dot.tsx';
import { board, awards, boardRows } from './race-run.ts';

export function Board(): Node {
  return (
    <section className="block">
      <h2>Таблица</h2>
      {/* место в строке рисует CSS-счётчик (.board li::before): он идёт по порядку строк */}
      <ol className="board" id="rBoard" elementRef={boardRows.attach}>
        <For each={board} by={(row) => row.entrant.id}>
          {(row) => (
            <li className={() => row().podium}>
              <CarDot look={() => row().entrant} />
              <span>{() => row().entrant.name}</span>
              <span className="res">{() => row().result}</span>
            </li>
          )}
        </For>
        <Show when={() => !board.value.length}>{() => <li className="empty">Добавь участников</li>}</Show>
      </ol>
      <div className="awards" id="rAwards">
        <For each={awards} by={(award) => award.title}>
          {(award) => <div className="award"><b>{() => award().title}</b>{() => award().text}</div>}
        </For>
      </div>
    </section>
  );
}
