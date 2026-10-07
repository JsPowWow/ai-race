// Попытки под трассой (#24): лента вердиктов — ▲ лучше, ▼ хуже, = так же — и карточка «Взять»,
// когда новый вариант лучше твоего мозга. Одна на вкладку, без окон поверх страницы. Данные — app/variants.ts.
import { For, Show } from '@reely/dommy';
import { autoTake, dismiss, feed, offer, take, type Attempt, type Source } from '../variants.ts';

const WORDS: Record<Attempt['mark'], string> = { better: 'лучше', worse: 'хуже', same: 'так же', first: 'первый мозг' };
const describe = (a: Attempt) => `${a.label}: ${a.mark === 'first' ? a.text : `${WORDS[a.mark]} — ${a.text}`}. Контрольный: ${a.result}${a.taken ? '. Взят' : ''}`;

export function Tries({ source, empty, control, duel }: {
  source: Source;
  /** Ты против мозга одной строкой («ты: 42,3 с · мозг: 45,1 с — ты быстрее на 2,8 с»); пусто — строки нет */
  duel?: () => string;
  /** Что написать, пока попыток нет: откуда они возьмутся */
  empty: string;
  /** На каких трассах контрольный заезд — словами */
  control: () => string;
}): Node {
  const list = () => feed(source);
  const last = () => list().at(-1);
  const waiting = () => offer(source);
  return (
    <>
      <div className="tries-head">
        <h2 className="tries-title">Попытки</h2>
        <ol className="tries-marks" aria={{ ariaLabel: 'Попытки по порядку, последняя справа' }}>
          <For each={list} by={(a) => a.id}>
            {(a) => (
              <li className="try-mark" data-mark={() => a().mark} data-taken={() => String(a().taken)} title={() => describe(a())}>
                <span className="sr-only">{() => describe(a())}</span>
              </li>
            )}
          </For>
        </ol>
        <p className="tries-last" aria={{ ariaLive: 'polite' }}>
          {() => {
            const a = last();
            if (!a) return empty;
            if (waiting()?.attempt === a) return ''; // то же самое написано в карточке ниже
            return `${a.label} — ${a.mark === 'first' ? a.text : `${WORDS[a.mark]}: ${a.text}`}`;
          }}
        </p>
        <label className="check tries-auto">
          <input type="checkbox" id={`${source}AutoTake`} checked={autoTake} onChange={(e) => (autoTake.value = e.currentTarget.checked)} />
          Брать лучшее само
        </label>
      </div>
      <Show when={() => duel?.()}>
        {(text) => <p className="tries-duel" id={`${source}Duel`}>{text}</p>}
      </Show>
      <Show when={waiting}>
        {(offer) => (
          <div className="offer" aria={{ role: 'group', ariaLabel: 'Новый вариант лучше твоего мозга' }}>
            <span className="try-mark" data-mark="better" aria={{ ariaHidden: true }} />
            <p className="offer-text">
              <b>Новый вариант лучше твоего мозга: {() => offer().attempt.text}</b>
              <span className="offer-note">{() => `${offer().attempt.label} · контрольный: ${offer().attempt.result} · ${control()}`}</span>
            </p>
            <div className="offer-actions">
              <button className="btn brain" onClick={() => take(source)}>Взять</button>
              <button className="btn" onClick={() => dismiss(source)}>Не надо</button>
            </div>
          </div>
        )}
      </Show>
    </>
  );
}
