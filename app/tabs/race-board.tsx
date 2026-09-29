// «Гонка», таблица и номинации. Строки не перерисовываются: при обгоне строка переезжает на новое место.
import { For, Show } from '@reely/dommy';
import { Avatar } from '../avatar.tsx';
import { board, awards } from './race-run.ts';

export function Board(): Node {
  return (
    <section className="block">
      <h2>Таблица</h2>
      {/* место в строке рисует CSS-счётчик (.board li::before): он идёт по порядку строк */}
      <ol className="board" id="rBoard">
        <For each={board} by={(row) => row.entrant.id}>
          {(row) => (
            <li className={() => row().podium}>
              <Avatar look={() => row().entrant} />
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
